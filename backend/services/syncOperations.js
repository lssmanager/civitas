const { and, desc, eq } = require("drizzle-orm");
const { db } = require("../db/client");
const { auditLogs, organizationProfiles, syncOperationSteps, syncOperations } = require("../db/schema");
const { QUEUE_NAME, enqueueSyncOperation, getSyncJobSnapshot } = require("./syncQueue");
const { getWorkerHealthSnapshot } = require("./operationalObservability");

const TECHNICAL_ERROR_PATTERN = /(select|insert|update|delete|from|where|failed query|syntax error|relation .* does not exist|organization_bootstrap_micro_requests|SQLSTATE|postgres|duplicate key)/i;

const OPERATION_STATUSES = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  CANONICAL_COMPLETED: "canonical_completed",
  DOWNSTREAM_RUNNING: "downstream_running",
  PARTIAL_FAILED: "partial_failed",
  COMPLETED: "completed",
  FAILED: "failed",
});

const PHASE_STATUSES = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  SKIPPED: "skipped",
});

const STEP_STATUSES = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  SKIPPED: "skipped",
});

const safeJson = (value) => (value === undefined ? null : value);
const toIso = (value) => value?.toISOString?.() ?? value ?? null;

function safeFunctionalMessage(message, fallback = "Hay una sincronización pendiente que requiere revisión.") {
  if (!message || typeof message !== "string") return fallback;
  if (TECHNICAL_ERROR_PATTERN.test(message)) return fallback;
  return message.length > 220 ? `${message.slice(0, 220)}…` : message;
}

const STEP_CLASSIFICATIONS = [
  { pattern: /fluentcrm[._-]company|company_profile|organization_profile_downstream/i, label: "FluentCRM company", system: "FluentCRM", action: "Reintentar sincronización de company" },
  { pattern: /fluentcrm[._-]contact|contact_identity|member_identity/i, label: "FluentCRM contact", system: "FluentCRM", action: "Reintentar sincronización de contacto" },
  { pattern: /branding.*css|logto_custom_css|organization_branding/i, label: "Branding Logto/CSS", system: "Logto", action: "Reintentar regeneración de branding" },
  { pattern: /branding|logto.organization.custom_data/i, label: "Logto organization", system: "Logto", action: "Reintentar actualización en Logto" },
];

const TERMINAL_STEP_STATUSES = new Set([STEP_STATUSES.COMPLETED, STEP_STATUSES.FAILED, STEP_STATUSES.SKIPPED, "unsupported"]);
const DOWNSTREAM_STEP_PATTERN = /^(fluentcrm\.|branding\.)|fluentcrm[._-](company|contact)|branding/i;
const NON_TERMINAL_STEP_STATUSES = new Set([STEP_STATUSES.QUEUED, STEP_STATUSES.RUNNING]);

function formatList(values = []) {
  const list = (Array.isArray(values) ? values : []).filter(Boolean);
  if (list.length <= 1) return list[0] || "";
  return `${list.slice(0, -1).join(", ")} y ${list[list.length - 1]}`;
}

function getLatestStep(item = {}) {
  const steps = Array.isArray(item.steps) ? item.steps : [];
  return steps[steps.length - 1] || null;
}

function pickVisibleStep(steps = []) {
  const ordered = Array.isArray(steps) ? [...steps] : [];
  const downstream = ordered.filter((step) => DOWNSTREAM_STEP_PATTERN.test(step.stepName || ""));
  return downstream.find((step) => NON_TERMINAL_STEP_STATUSES.has(step.status))
    || [...downstream].reverse().find((step) => step.status === STEP_STATUSES.FAILED || step.lastErrorJson)
    || ordered.find((step) => NON_TERMINAL_STEP_STATUSES.has(step.status))
    || [...ordered].reverse().find((step) => step.status === STEP_STATUSES.FAILED || step.lastErrorJson)
    || downstream[downstream.length - 1]
    || ordered[ordered.length - 1]
    || null;
}

function buildQueueProjection(item = {}, visibleStep = null) {
  const snapshot = item.jobSnapshot || {};
  const retryState = snapshot.retryState || deriveRetryState(item, visibleStep);
  const workerHealth = item.workerHealth || {};
  return {
    queueName: snapshot.queueName || visibleStep?.queueName || item.queueName || QUEUE_NAME,
    jobId: snapshot.jobId || visibleStep?.jobId || item.jobId || null,
    retryState,
    enqueuedAt: snapshot.enqueuedAt || item.enqueuedAt || null,
    lastAttemptAt: snapshot.lastAttemptAt || item.lastAttemptAt || null,
    jobAgeSeconds: snapshot.jobAgeSeconds ?? item.jobAgeSeconds ?? null,
    workerHeartbeatState: workerHealth.workerHeartbeatState || workerHealth.state || item.workerHeartbeatState || (retryState === "queued" ? "unknown" : null),
  };
}

function classifyOperation(item = {}, step = null) {
  const type = [step?.stepName, item.operationType, item.stepName].filter(Boolean).join(" ") || "organization_sync";
  const match = STEP_CLASSIFICATIONS.find((entry) => entry.pattern.test(type));
  if (match) return match;
  if (/member/i.test(type)) return { label: "FluentCRM contact", system: "FluentCRM", action: "Reintentar sincronización de contacto" };
  return { label: "Sincronización operacional", system: "Downstream", action: "Reintentar solo este pendiente" };
}

function deriveRetryState(item = {}, step = null) {
  if (item.status === OPERATION_STATUSES.QUEUED || step?.status === STEP_STATUSES.QUEUED) return "queued";
  if ([OPERATION_STATUSES.RUNNING, OPERATION_STATUSES.DOWNSTREAM_RUNNING].includes(item.status) || step?.status === STEP_STATUSES.RUNNING) return "running";
  if ([OPERATION_STATUSES.FAILED, OPERATION_STATUSES.PARTIAL_FAILED].includes(item.status) || step?.status === STEP_STATUSES.FAILED) return item.retryCount > 0 ? "failed_again" : "failed";
  if (item.status === OPERATION_STATUSES.COMPLETED || step?.status === STEP_STATUSES.COMPLETED) return "completed";
  return item.retryCount > 0 ? "requested" : "not_requested";
}

function buildActionableMessage({ classified, details, missingFields, fieldDiffs, providerCode, providerStatus, retryState, rawError }) {
  if (retryState === "queued") return "Reintento solicitado; job en cola";
  if (retryState === "running") return "Reintento en ejecución";
  if (retryState === "failed_again") return "Retry falló nuevamente";
  if (details.humanMessage) return details.humanMessage;
  if (providerCode === "FLUENTCRM_DUPLICATE_CONTACT") return "FluentCRM rechazó el contacto por email duplicado";
  if (/missing_company_id|company_not_linked/i.test(String(providerCode || details.reason || rawError || ""))) return classified.label.includes("contact") ? "Falta company_id para sincronizar el contacto" : "Falta crear company en FluentCRM";
  if (/missing_user_role/i.test(String(providerCode || details.reason || rawError || ""))) return "Falta user_role para sincronizar el contacto";
  if (missingFields.length) return `Falta sincronizar ${formatList(missingFields)}`;
  const diffFields = Object.keys(fieldDiffs || {});
  if (diffFields.length) return `Hay cambios pendientes en ${formatList(diffFields)}`;
  if (/validation|invalid/i.test(String(providerCode || providerStatus || ""))) return `${classified.label}: falló validación`;
  if (rawError) return rawError;
  return `${classified.label}: ${providerStatus || "pendiente"}`;
}

function serializePending(item, organizationName = null) {
  const visibleStep = pickVisibleStep(item.steps);
  const step = getLatestStep(item);
  const classified = classifyOperation(step || item, visibleStep);
  const stepOutput = visibleStep?.outputJson?.result || visibleStep?.outputJson || {};
  const snapshot = item.resultSnapshotJson?.workerOutcome?.result || item.resultSnapshotJson || item.payloadSnapshotJson || {};
  const details = { ...snapshot, ...stepOutput };
  const rawError = item.lastError || item.errorMessage || item.lastErrorJson?.message || visibleStep?.lastErrorJson?.message || step?.lastErrorJson?.message || item.humanMessage || null;
  const fieldsSent = details.fieldsSent || details.payloadSummary?.fieldsSent || [];
  const missingFields = details.missingFields || details.payloadSummary?.missingFields || [];
  const fieldDiffs = details.fieldDiffs || null;
  const providerStatus = details.providerStatus || details.status || visibleStep?.status || item.status || null;
  const providerCode = details.providerCode || details.code || item.lastErrorJson?.providerCode || visibleStep?.lastErrorJson?.providerCode || null;
  const retryState = deriveRetryState(item, visibleStep);
  const actionableMessage = item.humanMessage || item.payloadSnapshotJson?.humanMessage || item.resultSnapshotJson?.humanMessage || buildActionableMessage({ classified, details, missingFields, fieldDiffs, providerCode, providerStatus, retryState, rawError });
  const queue = buildQueueProjection(item, visibleStep);
  return {
    id: item.pendingId || item.id,
    operationId: item.operationId || item.id,
    organizationId: item.organizationId || item.logtoOrganizationId || item.entityId || null,
    organizationName,
    operationType: item.operationType || null,
    type: item.type || classified.label,
    affectedSystem: item.affectedSystem || classified.system,
    entityType: details.entityType || item.entityType || null,
    targetIdentity: details.targetIdentity || details.identity || null,
    stepName: visibleStep?.stepName || item.stepName || item.operationType || null,
    queueName: visibleStep?.queueName || null,
    jobId: visibleStep?.jobId || null,
    fieldsSent,
    missingFields,
    fieldDiffs,
    providerStatus,
    providerCode,
    humanMessage: safeFunctionalMessage(actionableMessage),
    status: item.status,
    requiresHumanAction: Boolean(item.requiresHumanAction || item.payloadSnapshotJson?.requiresHumanAction || details.requiresHumanAction),
    retryable: Boolean(item.retryable || item.lastErrorJson?.retryable || visibleStep?.lastErrorJson?.retryable || ["failed", "partial_failed", "error"].includes(item.status)),
    lastError: safeFunctionalMessage(
      rawError,
      classified.system === "FluentCRM"
        ? actionableMessage || "No se pudo completar la sincronización con FluentCRM. Logto conserva los datos canónicos."
        : undefined
    ),
    technicalErrorPresent: Boolean(rawError && TECHNICAL_ERROR_PATTERN.test(rawError)),
    suggestedAction: item.suggestedAction || details.suggestedAction || classified.action,
    queueName: queue.queueName,
    jobId: queue.jobId,
    retryState: queue.retryState,
    enqueuedAt: queue.enqueuedAt,
    lastAttemptAt: queue.lastAttemptAt,
    workerHeartbeatState: queue.workerHeartbeatState,
    jobAgeSeconds: queue.jobAgeSeconds,
    metadata: item.metadata || item.payloadSnapshotJson || item.resultSnapshotJson || null,
    createdAt: toIso(item.createdAt),
    updatedAt: toIso(item.updatedAt),
  };
}

function classifyOperationalError(error = {}) {
  const message = error.message || "Operational sync failed";
  const status = Number(error.status || error.statusCode || 0);
  const code = error.code || error.diagnostic?.code || null;
  const requestPath = error.request?.path || "";
  let system = "unknown";
  let retryable = true;
  let category = "unknown_error";

  if (code?.startsWith?.("FLUENTCRM") || /fluentcrm/i.test(message)) system = "fluentcrm";
  if (code?.startsWith?.("LOGTO") || /logto/i.test(message) || requestPath) system = "logto";
  if (/wordpress|buddyboss|rest_route|catalog/i.test(message)) system = "wordpress";
  if (/redis|ECONNREFUSED|SocketClosed/i.test(message)) {
    system = "redis";
    category = "redis_unavailable";
  }
  if (/database|postgres|ECONNREFUSED/i.test(message)) {
    system = system === "redis" ? system : "database";
    category = category === "redis_unavailable" ? category : "db_unavailable";
  }
  if (status === 422 || code === "FLUENTCRM_VALIDATION_FAILED" || code === "FLUENTCRM_DUPLICATE_CONTACT") {
    category = "validation_error";
    retryable = false;
    if (code === "FLUENTCRM_VALIDATION_FAILED" || code === "FLUENTCRM_DUPLICATE_CONTACT" || system !== "logto") system = "fluentcrm";
  } else if (/CONFIG|CONTRACT|MISMATCH|DUPLICATE|CONFLICT/i.test(String(code))) {
    category = /CONFLICT|DUPLICATE/.test(String(code)) ? "conflict" : "configuration_or_contract_error";
    retryable = false;
  } else if (status === 401 || status === 403 || /AUTH/i.test(String(code))) {
    category = "auth_error";
    retryable = false;
  } else if (status === 404 && system === "wordpress") {
    category = "route_or_catalog_error";
    retryable = false;
  } else if (status >= 400 && status < 500) {
    category = "validation_error";
    retryable = false;
  } else if (status >= 500 || /timeout|ETIMEDOUT|AbortError/i.test(message)) {
    category = "timeout_or_remote_error";
  }

  return {
    message,
    code,
    status: status || null,
    system,
    category,
    retryable,
    diagnostic: safeJson(error.diagnostic),
    body: safeJson(error.body),
    request: safeJson(error.request),
  };
}

const CRM_PENDING_STATUSES = new Set(["not_linked", "pending", "error", "conflict"]);
const LOGTO_OK_STATUSES = new Set(["logto_created", "metadata_linked", "bootstrapped", "synced", "reconciled"]);

function getMissingCompanyFields(profile = {}) {
  const settings = profile.settings || {};
  const business = settings.civitasProfile?.business || settings.business || {};
  const missing = [];
  if (!business.state && !business.department) missing.push("state");
  if (!business.city) missing.push("city");
  if (!business.postalCode && !business.postal_code) missing.push("postal_code");
  return missing;
}

function buildProjectedCrmPending(profile, latestOperation = null, workerHealth = {}) {
  if (!profile?.logtoOrganizationId) return null;
  const logtoOk = LOGTO_OK_STATUSES.has(profile.logtoSyncStatus) || Boolean(profile.logtoSyncedAt);
  if (!logtoOk || !CRM_PENDING_STATUSES.has(profile.fluentcrmSyncStatus)) return null;
  const missingFields = !profile.fluentcrmCompanyId ? getMissingCompanyFields(profile) : [];
  const stepName = profile.fluentcrmCompanyId ? "fluentcrm.company.patch" : "fluentcrm.company.create";
  const humanMessage = !profile.fluentcrmCompanyId
    ? missingFields.length
      ? `Faltan campos para crear la company: ${missingFields.join(", ")}`
      : "Microacción encolada: crear company en FluentCRM"
    : profile.fluentcrmSyncStatus === "error"
      ? "La company en FluentCRM falló al sincronizar"
      : "Hay cambios pendientes para la company en FluentCRM";
  return {
    ...(latestOperation || {}),
    pendingId: `crm-company-${profile.logtoOrganizationId}`,
    operationId: latestOperation?.id || `crm-company-${profile.logtoOrganizationId}`,
    logtoOrganizationId: profile.logtoOrganizationId,
    entityId: profile.logtoOrganizationId,
    type: "FluentCRM company",
    affectedSystem: "FluentCRM",
    entityType: "fluentcrm.company",
    targetIdentity: profile.fluentcrmCompanyId || profile.logtoOrganizationId,
    stepName,
    operationType: stepName,
    status: profile.fluentcrmSyncStatus === "not_linked" ? "pending" : profile.fluentcrmSyncStatus,
    retryable: true,
    humanMessage,
    suggestedAction: profile.fluentcrmCompanyId ? "Reenviar datos a CRM" : missingFields.length ? "Revisar campos faltantes" : "Reintentar create company",
    requiresHumanAction: Boolean(missingFields.length),
    providerCode: profile.fluentcrmSyncStatus === "not_linked" ? "FLUENTCRM_COMPANY_MISSING" : null,
    providerStatus: profile.fluentcrmSyncStatus,
    metadata: { missingFields, fluentcrmCompanyId: profile.fluentcrmCompanyId, logtoStatus: profile.logtoSyncStatus, crmStatus: profile.fluentcrmSyncStatus },
    payloadSnapshotJson: { humanMessage, missingFields, logtoStatus: profile.logtoSyncStatus, crmStatus: profile.fluentcrmSyncStatus, fieldsSent: Object.keys((profile.settings?.civitasProfile?.business || profile.settings?.business || {})), affectedSystem: "FluentCRM" },
    workerHealth,
    createdAt: latestOperation?.createdAt || profile.updatedAt,
    updatedAt: latestOperation?.updatedAt || profile.updatedAt,
  };
}

async function createCanonicalSyncOperation({
  operationType,
  entityType,
  entityId = null,
  logtoOrganizationId = null,
  logtoUserId = null,
  correlationId,
  idempotencyKey,
  payloadSnapshotJson,
  database = db,
}) {
  const [existing] = idempotencyKey
    ? await database.select().from(syncOperations).where(eq(syncOperations.idempotencyKey, idempotencyKey)).limit(1)
    : [];
  if (existing) return existing;

  const [operation] = await database.insert(syncOperations).values({
    operationType,
    entityType,
    entityId,
    logtoOrganizationId,
    logtoUserId,
    status: OPERATION_STATUSES.QUEUED,
    canonicalStatus: PHASE_STATUSES.PENDING,
    downstreamStatus: PHASE_STATUSES.PENDING,
    correlationId,
    idempotencyKey,
    payloadSnapshotJson: safeJson(payloadSnapshotJson),
    resultSnapshotJson: {},
    retryCount: 0,
  }).returning();

  return operation;
}

// Deprecated compatibility shim for historic callers. New code must pass the canonical
// operation contract (entityType, correlationId, idempotencyKey, payloadSnapshotJson).
async function createLegacySyncOperation({
  organizationId,
  operationType,
  metadata = {},
  status = "queued",
  retryable = true,
  stepName = null,
  errorMessage = null,
}) {
  const values = {
    operationType,
    entityType: "organization",
    entityId: organizationId,
    logtoOrganizationId: organizationId,
    status,
    canonicalStatus: status,
    downstreamStatus: status,
    correlationId: metadata?.correlationId || `legacy:${operationType}:${organizationId || "none"}:${Date.now()}`,
    idempotencyKey: metadata?.idempotencyKey || `legacy:${operationType}:${organizationId || "none"}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    payloadSnapshotJson: metadata,
    resultSnapshotJson: {},
    lastErrorJson: errorMessage ? { message: errorMessage, retryable } : null,
    correlationId: metadata.correlationId || `${operationType}:${organizationId}:${Date.now()}`,
    idempotencyKey: metadata.idempotencyKey || `${operationType}:${organizationId}:${Date.now()}`,
    retryCount: 0,
    updatedAt: new Date(),
  };

  const [operation] = await db.insert(syncOperations).values(values).returning();

  if (stepName) {
    await recordOperationStep({
      operationId: operation.id,
      stepName,
      queueName: "legacy-sync",
      jobId: operation.id,
      attempt: 1,
      status,
      lastErrorJson: errorMessage ? { message: errorMessage, retryable } : null,
      outputJson: metadata,
    });
  }

  await enqueueSyncOperation(operation).catch((error) =>
    console.error("Failed to enqueue sync operation", { operationId: operation.id, operationType, error })
  );

  return operation;
}

async function createSyncOperation(args) {
  if (args && ("entityType" in args || "idempotencyKey" in args || "logtoOrganizationId" in args)) {
    return createCanonicalSyncOperation(args);
  }
  return createLegacySyncOperation(args);
}

async function updateSyncOperation({ id, ...patch }) {
  const status = patch.status;
  const terminal = [OPERATION_STATUSES.COMPLETED, OPERATION_STATUSES.PARTIAL_FAILED, OPERATION_STATUSES.FAILED].includes(status);
  const update = { ...patch, updatedAt: new Date() };

  if ("payloadSnapshotJson" in patch) update.payloadSnapshotJson = safeJson(patch.payloadSnapshotJson);
  if ("resultSnapshotJson" in patch) update.resultSnapshotJson = safeJson(patch.resultSnapshotJson);
  if ("lastErrorJson" in patch) update.lastErrorJson = safeJson(patch.lastErrorJson);
  if (terminal) update.finishedAt = new Date();

  const [operation] = await db.update(syncOperations).set(update).where(eq(syncOperations.id, id)).returning();
  return operation;
}

async function recordOperationStep({
  operationId,
  stepName,
  queueName,
  jobId,
  attempt = 1,
  status,
  outputJson = null,
  lastErrorJson = null,
}) {
  const now = new Date();
  const [existing] = await db.select().from(syncOperationSteps)
    .where(and(eq(syncOperationSteps.operationId, operationId), eq(syncOperationSteps.stepName, stepName), eq(syncOperationSteps.attempt, attempt)))
    .limit(1);

  if (existing) {
    const [updated] = await db.update(syncOperationSteps).set({
      queueName,
      jobId: jobId ? String(jobId) : null,
      status,
      outputJson: safeJson(outputJson),
      lastErrorJson: safeJson(lastErrorJson),
      updatedAt: now,
      finishedAt: [STEP_STATUSES.COMPLETED, STEP_STATUSES.FAILED, STEP_STATUSES.SKIPPED].includes(status) ? now : null,
    }).where(eq(syncOperationSteps.id, existing.id)).returning();

    return updated;
  }

  const [step] = await db.insert(syncOperationSteps).values({
    operationId,
    stepName,
    queueName,
    jobId: jobId ? String(jobId) : null,
    attempt,
    status,
    outputJson: safeJson(outputJson),
    lastErrorJson: safeJson(lastErrorJson),
    startedAt: status === STEP_STATUSES.RUNNING ? now : null,
    finishedAt: [STEP_STATUSES.COMPLETED, STEP_STATUSES.FAILED, STEP_STATUSES.SKIPPED].includes(status) ? now : null,
  }).returning();

  return step;
}

async function getSyncOperationWithSteps(id) {
  const [operation] = await db.select().from(syncOperations).where(eq(syncOperations.id, id)).limit(1);
  if (!operation) return null;

  const steps = await db.select().from(syncOperationSteps)
    .where(eq(syncOperationSteps.operationId, id))
    .orderBy(syncOperationSteps.createdAt);

  return { ...operation, steps };
}

async function getLatestOperationForOrganization(logtoOrganizationId) {
  const [operation] = await db.select().from(syncOperations)
    .where(eq(syncOperations.logtoOrganizationId, logtoOrganizationId))
    .orderBy(desc(syncOperations.createdAt))
    .limit(1);

  return operation ? getSyncOperationWithSteps(operation.id) : null;
}

async function listOrganizationPendingSync({ organizationId }) {
  const [operations, profiles, workerHealth] = await Promise.all([
    db.select().from(syncOperations)
      .where(eq(syncOperations.logtoOrganizationId, organizationId))
      .orderBy(desc(syncOperations.updatedAt))
      .limit(50),
    db.select().from(organizationProfiles).where(eq(organizationProfiles.logtoOrganizationId, organizationId)).limit(1),
    getWorkerHealthSnapshot().catch(() => ({})),
  ]);
  const withSteps = await Promise.all(operations.map((operation) => getSyncOperationWithSteps(operation.id)));
  const enriched = await Promise.all(withSteps.filter(Boolean).map(async (operation) => ({
    ...operation,
    workerHealth,
    jobSnapshot: await getSyncJobSnapshot(operation).catch(() => null),
  })));
  const profile = profiles[0] || null;
  const projected = buildProjectedCrmPending(profile, enriched[0], workerHealth);
  const rows = projected ? [projected, ...enriched] : enriched;

  return rows
    .map((operation) => serializePending(operation, profile?.nameCache || null))
    .filter((item, index, list) => item.status !== "completed" && item.status !== "succeeded" && list.findIndex((other) => other.id === item.id) === index);
}

async function retrySyncOperation({ operationId, organizationId }) {
  const now = new Date();
  const [operation] = await db.update(syncOperations)
    .set({
      status: OPERATION_STATUSES.QUEUED,
      downstreamStatus: PHASE_STATUSES.PENDING,
      lastErrorJson: null,
      updatedAt: now,
    })
    .where(eq(syncOperations.id, operationId))
    .returning();

  if (operation) {
    const enqueueResult = await enqueueSyncOperation(operation).catch((error) => {
      console.error("Failed to enqueue sync retry", { operationId: operation.id, error });
      return { enqueued: false, reason: error.message };
    });
    const withSteps = await getSyncOperationWithSteps(operation.id).catch(() => null);
    const visibleStep = pickVisibleStep(withSteps?.steps || []);
    const retryStepName = visibleStep?.stepName || (operation.operationType?.includes("contact") ? "fluentcrm.contact.upsert:retry" : operation.operationType?.includes("company") || operation.operationType?.includes("profile") ? "fluentcrm.company.ensure" : "sync.retry.enqueue");
    await recordOperationStep({
      operationId: operation.id,
      stepName: retryStepName,
      queueName: enqueueResult.queueName || QUEUE_NAME,
      jobId: enqueueResult.jobId || `sync-operation-${operation.id}`,
      status: STEP_STATUSES.QUEUED,
      outputJson: { ...enqueueResult, stepName: retryStepName, entityType: retryStepName.includes("contact") ? "fluentcrm.contact" : retryStepName.includes("company") ? "fluentcrm.company" : "sync.operation", humanMessage: retryStepName.includes("company") ? "Retry encolado para FluentCRM company" : retryStepName.includes("contact") ? "Retry encolado para FluentCRM contact" : "Retry encolado para operación downstream" },
    });
    return operation;
  }

  // Projected CRM pendings are functional rows (for example crm-company-<org>)
  // with no persisted sync_operations record yet. Retrying them must enqueue the
  // downstream CRM operation directly, not a generic bootstrap/manual marker.
  return createCanonicalSyncOperation({
    operationType: "organization_profile_downstream_sync",
    entityType: "fluentcrm.company",
    entityId: organizationId,
    logtoOrganizationId: organizationId,
    correlationId: `owner-crm-retry:${organizationId}:${Date.now()}`,
    idempotencyKey: `owner-crm-retry:${organizationId}:${Date.now()}`,
    payloadSnapshotJson: {
      requestedFrom: "owner_console",
      requestedOperationId: operationId,
      stepName: "fluentcrm.company.ensure",
      entityType: "fluentcrm.company",
      targetIdentity: organizationId,
      humanMessage: "Retry solicitado para FluentCRM company",
    },
  }).then(async (created) => {
    const enqueueResult = await enqueueSyncOperation(created).catch((error) => ({ enqueued: false, reason: error.message, queueName: QUEUE_NAME, jobId: `sync-operation-${created.id}` }));
    await recordOperationStep({
      operationId: created.id,
      stepName: "fluentcrm.company.ensure",
      queueName: enqueueResult.queueName || QUEUE_NAME,
      jobId: enqueueResult.jobId || `sync-operation-${created.id}`,
      status: STEP_STATUSES.QUEUED,
      outputJson: { ...enqueueResult, entityType: "fluentcrm.company", targetIdentity: organizationId, humanMessage: "Retry encolado para FluentCRM company" },
    });
    return created;
  });
}

async function listOrganizationEvents({ organizationId, limit = 30 }) {
  const [ops, logs] = await Promise.all([
    db.select().from(syncOperations).where(eq(syncOperations.logtoOrganizationId, organizationId)).orderBy(desc(syncOperations.updatedAt)).limit(limit),
    db.select().from(auditLogs).where(eq(auditLogs.organizationId, organizationId)).orderBy(desc(auditLogs.createdAt)).limit(limit),
  ]);

  const opsWithSteps = await Promise.all(ops.map((op) => getSyncOperationWithSteps(op.id).then((withSteps) => withSteps || op)));

  const events = [
    ...opsWithSteps.map((op) => {
      const pending = serializePending(op);
      return {
        id: `op-${op.id}`,
        at: toIso(op.updatedAt),
        type: pending.type,
        result: op.status,
        stage: pending.stepName || op.operationType,
        stepName: pending.stepName,
        targetIdentity: pending.targetIdentity,
        providerCode: pending.providerCode,
        retryState: pending.retryState,
        humanMessage: pending.humanMessage,
        message: pending.humanMessage || pending.lastError,
        requiresAction: pending.retryable,
        retryOperationId: op.id,
      };
    }),
    ...logs.map((log) => ({
      id: `audit-${log.id}`,
      at: toIso(log.createdAt),
      type: log.metadata?.entityType === "fluentcrm.company" ? "FluentCRM company" : log.metadata?.entityType === "fluentcrm.contact" ? "FluentCRM contact" : "Evento administrativo",
      result: log.result,
      stage: log.metadata?.stepName || log.metadata?.stage || log.action,
      message: safeFunctionalMessage(log.metadata?.humanMessage || log.metadata?.message || log.metadata?.stage || log.action, "Evento registrado para esta organización."),
      requiresAction: log.result === "error",
      retryOperationId: null,
      stepName: log.metadata?.stepName || null,
      targetIdentity: log.metadata?.targetIdentity || null,
      providerCode: log.metadata?.providerCode || null,
      retryState: log.metadata?.retryState || null,
      humanMessage: safeFunctionalMessage(log.metadata?.humanMessage || log.metadata?.message || log.metadata?.stage || log.action, "Evento registrado para esta organización."),
      stepName: log.metadata?.stepName || null,
      entityType: log.metadata?.entityType || null,
      targetIdentity: log.metadata?.targetIdentity || null,
      queueName: log.metadata?.queueName || null,
      jobId: log.metadata?.jobId || null,
      retryState: log.metadata?.retryState || null,
      workerHeartbeatState: log.metadata?.workerHeartbeatState || null,
      jobAgeSeconds: log.metadata?.jobAgeSeconds ?? null,
    })),
  ];

  return events.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0)).slice(0, limit);
}

module.exports = {
  OPERATION_STATUSES,
  PHASE_STATUSES,
  STEP_STATUSES,
  classifyOperationalError,
  createSyncOperation,
  getLatestOperationForOrganization,
  getSyncOperationWithSteps,
  listOrganizationEvents,
  listOrganizationPendingSync,
  recordOperationStep,
  retrySyncOperation,
  safeFunctionalMessage,
  serializePending,
  updateSyncOperation,
};
