const {
  ACTIVE_OPERATION_STATUSES,
  FRESHNESS_SOURCES,
  buildConsolidatedOperationalResponse: buildContractResponse,
  buildFreshness,
  buildInvalidation,
  buildOperationalBlock,
  buildSummary,
} = require("./operational/contract");

const ACTIVE_QUEUE_STATES = new Set(["queued", "taken_by_worker", "running", "downstream_running", "processing", "active", "waiting", "delayed", "stuck_in_queue", "worker_offline"]);
const TERMINAL_QUEUE_STATES = new Set(["completed", "partial_failed", "failed", "succeeded", "success"]);

const toIso = (value) => value?.toISOString?.() ?? value ?? null;
const safeArray = (value) => (Array.isArray(value) ? value : []);
const safeObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

function isActiveQueueState(value) {
  return ACTIVE_QUEUE_STATES.has(String(value || ""));
}

function operationIdOf(item = {}) {
  return item.operationId || item.id || null;
}

function latestTimestamp(...values) {
  const dates = values.flat().filter(Boolean).map((value) => new Date(value)).filter((date) => !Number.isNaN(date.getTime()));
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString();
}

function buildBaseOperationalBlock({ status = "unknown", severity = "info", source = FRESHNESS_SOURCES.LOCAL_RECONCILED, checkedAt = new Date(), staleAfterSeconds, pending = [], events = [], operationIds, details = {}, runtime = null, ...rest } = {}) {
  const ids = operationIds || safeArray(pending).map(operationIdOf).filter(Boolean);
  const lastEvent = safeArray(events)[0] || null;
  return buildOperationalBlock({
    status,
    severity,
    freshness: buildFreshness({ source, checkedAt, staleAfterSeconds }),
    invalidation: buildInvalidation({ invalidateOnOperationIds: ids, invalidateOnStatuses: ["queued", "running", "completed", "failed", "partial_failed"], lastEventId: lastEvent?.id || null }),
    details,
    runtime,
    ...rest,
  });
}

function findPending(pending, matcher) {
  return safeArray(pending).find(matcher) || null;
}

function isProviderVerificationRecord(item = {}) {
  return item.operationType === "provider_verification"
    || /provider_verification/.test(String(item.stepName || item.stage || item.type || ""));
}

function providerStatusFromEvent(event = {}) {
  if (event.providerStatus) return event.providerStatus;
  if (event.metadata?.providerStatus) return event.metadata.providerStatus;
  if (event.providerCode === "ALL_OK" || event.metadata?.providerCode === "ALL_OK") return "all_ok";
  return event.result || null;
}

function normalizeProviderVerificationEvent(event = {}) {
  if (!isProviderVerificationRecord(event)) return null;
  const providerStatus = providerStatusFromEvent(event);
  return {
    operationId: event.retryOperationId || event.operationId || String(event.id || "").replace(/^op-/, "") || null,
    eventId: event.id || null,
    operationType: "provider_verification",
    status: event.result || event.status || providerStatus || "completed",
    providerStatus,
    providerCode: event.providerCode || event.metadata?.providerCode || null,
    humanMessage: event.humanMessage || event.message || event.metadata?.humanMessage || null,
    updatedAt: event.updatedAt || event.at || event.createdAt || null,
    sourceEvent: event,
  };
}

function findProviderVerification({ pending = [], events = [] } = {}) {
  const pendingProvider = findPending(pending, isProviderVerificationRecord);
  if (pendingProvider && (ACTIVE_OPERATION_STATUSES.has(pendingProvider.status) || isActiveQueueState(pendingProvider.retryState))) return pendingProvider;
  const eventProvider = safeArray(events).map(normalizeProviderVerificationEvent).filter(Boolean).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0] || null;
  if (!pendingProvider) return eventProvider;
  if (!eventProvider) return pendingProvider;
  return new Date(eventProvider.updatedAt || 0) > new Date(pendingProvider.updatedAt || 0) ? eventProvider : pendingProvider;
}

function buildCanonicalOperationalBlock({ logtoOrganization, profile, pending = [], events = [], checkedAt = new Date() } = {}) {
  const unavailable = logtoOrganization?._unavailable === true;
  const ok = Boolean(logtoOrganization && !unavailable);
  const status = unavailable ? "degraded" : ok ? "ok" : "missing";
  const severity = unavailable ? "warning" : ok ? "success" : "critical";
  const humanMessage = unavailable
    ? "No se pudo verificar la organización canónica en Logto debido a un error transitorio."
    : ok
    ? "Organización canónica presente en Logto."
    : "No se pudo confirmar la organización canónica en Logto.";
  const providerCode = unavailable ? "LOGTO_ORGANIZATION_UNAVAILABLE" : ok ? "LOGTO_ORGANIZATION_FOUND" : "LOGTO_ORGANIZATION_MISSING";
  const providerStatus = unavailable ? "unavailable" : ok ? "found" : "missing";
  return buildBaseOperationalBlock({
    status,
    severity,
    source: FRESHNESS_SOURCES.LIVE_PROVIDER_CHECK,
    checkedAt,
    staleAfterSeconds: 120,
    pending,
    events,
    humanMessage,
    providerCode,
    providerStatus,
    details: { sourceOfTruth: "logto", logtoOrganizationId: profile?.logtoOrganizationId || logtoOrganization?.id || null, topLevelFields: ok ? ["id", "name", "description", "customData"] : [], ...(unavailable ? { error: logtoOrganization._error } : {}) },
  });
}

function buildFluentCrmOperationalBlock({ profile, pending = [], events = [] } = {}) {
  const company = findPending(pending, (item) => item.entityType === "fluentcrm.company" || /fluentcrm.*company|organization_profile_downstream/i.test(String(item.stepName || item.operationType || "")));
  const active = company && (ACTIVE_OPERATION_STATUSES.has(company.status) || isActiveQueueState(company.retryState));
  return buildBaseOperationalBlock({
    status: company ? company.status : profile?.fluentcrmCompanyId ? "linked" : "missing_company",
    severity: company ? (company.retryable ? "warning" : "critical") : profile?.fluentcrmCompanyId ? "success" : "warning",
    source: active ? FRESHNESS_SOURCES.WORKER_RUNTIME : profile?.fluentcrmCompanyId ? FRESHNESS_SOURCES.LOCAL_RECONCILED : FRESHNESS_SOURCES.PERSISTED_SNAPSHOT,
    checkedAt: company?.updatedAt || profile?.fluentcrmSyncedAt || profile?.updatedAt || new Date(),
    staleAfterSeconds: active ? 30 : 300,
    pending: company ? [company] : [],
    events,
    humanMessage: company?.humanMessage || (profile?.fluentcrmCompanyId ? "Company FluentCRM enlazada como downstream comercial." : "Falta crear o enlazar Company en FluentCRM."),
    providerCode: company?.providerCode || null,
    providerStatus: company?.providerStatus || profile?.fluentcrmSyncStatus || null,
    details: { organizationId: profile?.logtoOrganizationId || null, fluentcrmCompanyId: profile?.fluentcrmCompanyId || null, pending: company, sourceOfTruth: "fluentcrm_wordpress" },
    runtime: company ? { isActive: Boolean(active), queueState: company.retryState || company.queueStatus || company.status, queueName: company.queueName || null, jobAgeSeconds: company.jobAgeSeconds ?? null } : null,
  });
}

function buildWordpressOperationalBlock({ profile, pending = [], events = [] } = {}) {
  const provider = findProviderVerification({ pending, events });
  const awaiting = provider?.providerStatus === "awaiting_first_wordpress_login";
  return buildBaseOperationalBlock({
    status: awaiting ? "expected_missing_user" : provider ? "verification_observed" : "not_live_verified",
    severity: awaiting ? "info" : provider ? "warning" : "info",
    source: provider ? FRESHNESS_SOURCES.LIVE_PROVIDER_CHECK : FRESHNESS_SOURCES.PERSISTED_SNAPSHOT,
    checkedAt: provider?.updatedAt || profile?.updatedAt || new Date(),
    staleAfterSeconds: 120,
    pending: provider && !provider.eventId ? [provider] : [],
    events,
    humanMessage: awaiting ? "El usuario WordPress local falta y es esperado hasta el primer login." : "WordPress no se usa como canon de autorización; requiere verificación live para estado downstream.",
    providerCode: provider?.providerCode || null,
    providerStatus: provider?.providerStatus || null,
    details: { authorizationCanonicalSource: "logto", wordpressUserIsAuthorizationCanon: false },
  });
}

function buildWorkerOperationalBlock({ workerHealth = {}, pending = [], events = [] } = {}) {
  const activeOperationIds = safeArray(pending).filter((item) => ACTIVE_OPERATION_STATUSES.has(item.status) || isActiveQueueState(item.retryState)).map(operationIdOf).filter(Boolean);
  const queueState = activeOperationIds.length ? "running" : TERMINAL_QUEUE_STATES.has(pending[0]?.status) ? pending[0].status : "idle";
  return buildBaseOperationalBlock({
    status: workerHealth.readiness || (activeOperationIds.length ? "running" : "unknown"),
    severity: workerHealth.readiness === "ready" ? "success" : workerHealth.readiness === "degraded" ? "warning" : "info",
    source: activeOperationIds.length ? FRESHNESS_SOURCES.WORKER_RUNTIME : FRESHNESS_SOURCES.LOCAL_RECONCILED,
    checkedAt: workerHealth.worker?.heartbeatAt || latestTimestamp(safeArray(pending).map((item) => item.updatedAt)) || new Date(),
    staleAfterSeconds: activeOperationIds.length ? 30 : 300,
    pending,
    events,
    humanMessage: workerHealth.worker?.heartbeatStale ? "Worker sin heartbeat fresco." : "Worker/cola observados para runtime operacional.",
    providerCode: workerHealth.redis?.status || null,
    providerStatus: workerHealth.worker?.workerHeartbeatState || workerHealth.worker?.state || null,
    details: { activeOperationIds, queueState, redis: workerHealth.redis || null, queues: workerHealth.queues || [] },
    runtime: { isActive: activeOperationIds.length > 0, queueState, workerHeartbeatState: workerHealth.worker?.workerHeartbeatState || workerHealth.worker?.state || null },
  });
}

function buildLiveVerificationOperationalBlock({ profile, pending = [], events = [] } = {}) {
  const provider = findProviderVerification({ pending, events });
  const source = provider ? FRESHNESS_SOURCES.LIVE_PROVIDER_CHECK : profile ? FRESHNESS_SOURCES.PERSISTED_SNAPSHOT : FRESHNESS_SOURCES.LOCAL_RECONCILED;
  return buildBaseOperationalBlock({
    status: provider?.providerStatus || provider?.status || "not_checked",
    severity: provider ? (provider.status === "completed" && ["all_ok", "ok", "success"].includes(provider.providerStatus) ? "success" : "warning") : "info",
    source,
    checkedAt: provider?.updatedAt || profile?.updatedAt || new Date(),
    staleAfterSeconds: provider ? 120 : 0,
    pending: provider && !provider.eventId ? [provider] : [],
    events,
    humanMessage: provider?.humanMessage || "No existe verificación live reciente; solo hay snapshot operativo local si está disponible.",
    providerCode: provider?.providerCode || null,
    providerStatus: provider?.providerStatus || null,
    details: { verificationSource: source, pending: provider && !provider.eventId ? provider : null, event: provider?.eventId ? provider.sourceEvent : null, dominance: "live_provider_check_over_local_reconciled_over_persisted_snapshot" },
  });
}

function normalizeContactProgressItem(raw = {}, fallback = {}) {
  const item = Object.keys(safeObject(raw.result)).length ? safeObject(raw.result) : raw;
  return {
    index: item.index ?? fallback.index ?? null,
    total: item.total ?? fallback.total ?? null,
    logtoUserId: item.logtoUserId ?? raw.logtoUserId ?? null,
    email: item.email ?? raw.email ?? null,
    fluentcrmCompanyId: item.fluentcrmCompanyId ?? fallback.fluentcrmCompanyId ?? null,
    fluentcrmContactId: item.fluentcrmContactId ?? item.contactId ?? null,
    action: item.action ?? raw.action ?? fallback.action ?? null,
    result: item.result ?? raw.resultStatus ?? raw.status ?? null,
    providerCode: item.providerCode ?? raw.providerCode ?? null,
    humanMessage: item.humanMessage ?? raw.humanMessage ?? null,
    createdAt: toIso(item.createdAt ?? raw.createdAt ?? fallback.createdAt ?? null),
  };
}

function extractContactItems(container, fallback = {}) {
  const obj = safeObject(container);
  const candidates = [obj.contactProgress, obj.contactsProgress, obj.contactResults, obj.resultsByContact, obj.contacts, obj.workerOutcome?.result?.contactProgress, obj.workerOutcome?.result?.contacts];
  return candidates.flatMap((value) => safeArray(value)).map((item, index, list) => normalizeContactProgressItem(item, { ...fallback, index: item.index ?? index + 1, total: item.total ?? list.length })).filter((item) => item.email || item.logtoUserId || item.fluentcrmContactId || item.humanMessage);
}

function buildContactProgressFromPendingAndEvents({ pending = [], events = [], profile } = {}) {
  const rows = [];
  for (const item of safeArray(pending)) {
    if (item.entityType === "fluentcrm.contact" || /contact|member_identity/i.test(String(item.stepName || item.operationType || ""))) {
      const extracted = extractContactItems(item.metadata, {
        createdAt: item.createdAt,
        fluentcrmCompanyId: profile?.fluentcrmCompanyId,
        action: item.stepName || item.operationType,
      });
      if (extracted.length) rows.push(...extracted);
      else rows.push(normalizeContactProgressItem(item, {
        createdAt: item.createdAt,
        fluentcrmCompanyId: profile?.fluentcrmCompanyId,
        action: item.stepName || item.operationType,
      }));
    }
  }
  for (const event of safeArray(events)) rows.push(...extractContactItems(event.metadata, { createdAt: event.createdAt, fluentcrmCompanyId: profile?.fluentcrmCompanyId }));
  const deduped = [];
  const seen = new Set();
  for (const row of rows) {
    const key = [row.logtoUserId, row.email, row.fluentcrmContactId, row.action, row.createdAt].join("|");
    if (!seen.has(key)) { seen.add(key); deduped.push(row); }
  }
  return deduped;
}

function buildContactProgressOperationalBlock({ profile, pending = [], events = [] } = {}) {
  const items = buildContactProgressFromPendingAndEvents({ pending, events, profile });
  const contact = findPending(pending, (item) => item.entityType === "fluentcrm.contact" || /fluentcrm.*contact|member_identity/i.test(String(item.stepName || item.operationType || "")));
  return buildBaseOperationalBlock({
    status: contact ? contact.status : items.length ? "observed" : "not_started",
    severity: contact && ["failed", "partial_failed"].includes(contact.status) ? "warning" : "info",
    source: contact && (ACTIVE_OPERATION_STATUSES.has(contact.status) || isActiveQueueState(contact.retryState)) ? FRESHNESS_SOURCES.WORKER_RUNTIME : FRESHNESS_SOURCES.LOCAL_RECONCILED,
    checkedAt: latestTimestamp(contact?.updatedAt, items.map((item) => item.createdAt)) || new Date(),
    staleAfterSeconds: contact ? 30 : 300,
    pending: contact ? [contact] : [],
    events,
    humanMessage: contact?.humanMessage || (items.length ? "Progreso de contactos derivado de resultados operativos persistidos." : "Sin progreso de contactos registrado."),
    providerCode: contact?.providerCode || null,
    providerStatus: contact?.providerStatus || null,
    details: { items, count: items.length, pending: contact || null },
  });
}

function buildOperationalSummary(blocks = {}) { return buildSummary(blocks); }

function buildPollingPolicy({ worker, pending = [] } = {}) {
  const activeOperationIds = worker?.details?.activeOperationIds || safeArray(pending).filter((item) => isActiveQueueState(item.retryState) || ACTIVE_OPERATION_STATUSES.has(item.status)).map(operationIdOf).filter(Boolean);
  const active = activeOperationIds.length > 0 || isActiveQueueState(worker?.details?.queueState || worker?.runtime?.queueState);
  if (active) return { shouldPoll: true, intervalSeconds: 3, reason: "active_worker_runtime", activeOperationIds };
  return { shouldPoll: false, intervalSeconds: 0, reason: "terminal_or_stable", activeOperationIds: [] };
}

function buildConsolidatedOperationalResponse({ organization, logtoOrganization, profile, pending = [], events = [], workerHealth = {}, generatedAt = new Date(), compatibility = {} } = {}) {
  const canonical = buildCanonicalOperationalBlock({ logtoOrganization, profile, pending, events, checkedAt: generatedAt });
  const fluentcrm = buildFluentCrmOperationalBlock({ profile, pending, events });
  const wordpress = buildWordpressOperationalBlock({ profile, pending, events });
  const worker = buildWorkerOperationalBlock({ workerHealth, pending, events });
  const liveVerification = buildLiveVerificationOperationalBlock({ profile, pending, events });
  const contactProgress = buildContactProgressOperationalBlock({ profile, pending, events });

  // Extract latest event IDs from actual events, not operation IDs
  const providerVerificationEvent = safeArray(events).find(isProviderVerificationRecord);
  const fluentcrmCompanyEvent = safeArray(events).find((e) => e.entityType === "fluentcrm.company" || /fluentcrm.*company|organization_profile_downstream/i.test(String(e.stepName || e.operationType || "")));
  const fluentcrmContactsEvent = safeArray(events).find((e) => e.entityType === "fluentcrm.contact" || /fluentcrm.*contact|member_identity/i.test(String(e.stepName || e.operationType || "")));

  const response = buildContractResponse({ organization, canonical, fluentcrm, wordpress, worker, liveVerification, contactProgress, latestEventIds: { audit: events[0]?.id || null, providerVerification: providerVerificationEvent?.id || null, fluentcrmCompany: fluentcrmCompanyEvent?.id || null, fluentcrmContacts: fluentcrmContactsEvent?.id || null }, generatedAt, compatibility });
  const localPolling = buildPollingPolicy({ worker, pending });
  const mergedPolling = response.polling?.shouldPoll ? response.polling : localPolling.shouldPoll ? localPolling : response.polling;
  return { ...response, summary: buildOperationalSummary({ canonical, fluentcrm, wordpress, worker, liveVerification, contactProgress }), polling: mergedPolling };
}

module.exports = {
  ACTIVE_QUEUE_STATES,
  buildFreshness,
  buildInvalidation,
  buildBaseOperationalBlock,
  buildCanonicalOperationalBlock,
  buildFluentCrmOperationalBlock,
  buildWordpressOperationalBlock,
  buildWorkerOperationalBlock,
  buildLiveVerificationOperationalBlock,
  buildContactProgressFromPendingAndEvents,
  buildOperationalSummary,
  buildPollingPolicy,
  buildConsolidatedOperationalResponse,
};
