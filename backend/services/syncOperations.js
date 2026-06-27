const { and, desc, eq, notInArray } = require("drizzle-orm");
const { db } = require("../db/client");
const { auditLogs, organizationProfiles, syncOperationSteps, syncOperations, manualSyncResolutions } = require("../db/schema");
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
const safeObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const safeArray = (value) => (Array.isArray(value) ? value : []);
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
const TERMINAL_OPERATION_STATUSES = new Set([OPERATION_STATUSES.COMPLETED, OPERATION_STATUSES.FAILED, OPERATION_STATUSES.PARTIAL_FAILED, "succeeded", "success", "skipped"]);
const RESENDABLE_STEP_PATTERN = /^(fluentcrm\.company\.(create|patch)|fluentcrm\.contact\.upsert)$/i;
const MANUAL_RESOLUTION_TYPES = new Set(["reviewed_no_action", "accepted_risk", "resolved_externally", "ignored_known_issue"]);
const DOWNSTREAM_STEP_PATTERN = /^(fluentcrm\.|branding\.)|fluentcrm[._-](company|contact)|branding/i;
const NON_TERMINAL_STEP_STATUSES = new Set([STEP_STATUSES.QUEUED, STEP_STATUSES.RUNNING]);

function formatList(values = []) {
  const list = (Array.isArray(values) ? values : []).filter(Boolean);
  if (list.length <= 1) return list[0] || "";
  return `${list.slice(0, -1).join(", ")} y ${list[list.length - 1]}`;
}

function getLatestStep(item = {}) {
  const steps = safeArray(item.steps);
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
  if (/FLUENTCRM_COMPANY_.*(CONFLICT|DUPLICATE)|duplicate.*company|ambiguous/i.test(String(providerCode || details.reason || rawError || ""))) return "No se pudo crear o enlazar la Company en FluentCRM: existe un conflicto por coincidencias duplicadas.";
  if (/FLUENTCRM_VALIDATION_FAILED|validation/i.test(String(providerCode || details.reason || rawError || "")) || Number(providerStatus) === 422) return "FluentCRM rechazó el payload de Company con error de validación 422.";
  if (Number(providerStatus) === 401 || /AUTH/.test(String(providerCode))) return "No se pudo autenticar contra FluentCRM.";
  if (Number(providerStatus) === 403) return "FluentCRM rechazó la solicitud por autorización insuficiente.";
  if (/TIMEOUT|timeout/i.test(String(providerCode || rawError || ""))) return "La solicitud a FluentCRM expiró por timeout.";
  if (providerCode === "FLUENTCRM_DUPLICATE_CONTACT") return "FluentCRM rechazó el contacto por email duplicado";
  if (/missing_company_id|company_not_linked|FLUENTCRM_COMPANY_ID_MISSING/i.test(String(providerCode || details.reason || rawError || ""))) return classified.label.includes("contact") ? "Falta company_id para sincronizar el contacto" : "Falta crear company en FluentCRM";
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
  const providerCode = details.providerCode || details.code || item.lastErrorJson?.providerCode || item.lastErrorJson?.code || visibleStep?.lastErrorJson?.providerCode || visibleStep?.lastErrorJson?.code || null;
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
    getWorkerHealthSnapshot(),
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

async function resendSyncOperationPayload({ operationId, organizationId, actorUserId = null }) {
  const operation = await getSyncOperationWithSteps(operationId);
  if (!operation) { const e = new Error("Sync operation not found for payload resend"); e.status = 404; throw e; }
  if (organizationId && operation.logtoOrganizationId && operation.logtoOrganizationId !== organizationId) { const e = new Error("Operation does not belong to organization"); e.status = 404; throw e; }
  const visibleStep = pickVisibleStep(operation.steps);
  const stepName = visibleStep?.stepName || operation.operationType;
  if (!RESENDABLE_STEP_PATTERN.test(String(stepName))) { const e = new Error(`Microacción no segura para reenviar payload: ${stepName || "unknown"}`); e.status = 409; e.reason = "microaction_not_whitelisted"; throw e; }
  const payloadSnapshotJson = safeObject(operation.payloadSnapshotJson);
  if (!Object.keys(payloadSnapshotJson).length) { const e = new Error("No hay payloadSnapshotJson seguro para reenviar"); e.status = 409; e.reason = "missing_payload_snapshot"; throw e; }
  const resent = await createCanonicalSyncOperation({ operationType: operation.operationType, entityType: operation.entityType, entityId: operation.entityId || operation.logtoOrganizationId, logtoOrganizationId: operation.logtoOrganizationId || organizationId, logtoUserId: operation.logtoUserId, correlationId: `owner-resend-payload:${operationId}:${Date.now()}`, idempotencyKey: `owner-resend-payload:${operationId}:${Date.now()}`, payloadSnapshotJson: { ...payloadSnapshotJson, requestedFrom: "owner_console", resendOfOperationId: operationId, resendOfStepId: visibleStep?.id || null, requestedByUserId: actorUserId, stepName, humanMessage: "Reenvío de payload solicitado por owner" } });
  const enqueueResult = await enqueueSyncOperation(resent).catch((error) => ({ enqueued: false, reason: error.message, queueName: QUEUE_NAME, jobId: `sync-operation-${resent.id}` }));
  await recordOperationStep({ operationId: resent.id, stepName, queueName: enqueueResult.queueName || QUEUE_NAME, jobId: enqueueResult.jobId || `sync-operation-${resent.id}`, status: STEP_STATUSES.QUEUED, outputJson: { ...enqueueResult, entityType: operation.entityType, targetIdentity: operation.entityId || operation.logtoOrganizationId, humanMessage: "Payload reenviado y microacción encolada", retryState: "queued" } });
  return { operation: resent, originalOperation: operation, stepName, enqueueResult };
}

async function manualResolveSyncOperation({ operationId, stepId = null, organizationId, resolutionType, resolutionReason = null, notes = null, appliesUntil = null, resolvedByUserId = null }) {
  if (!MANUAL_RESOLUTION_TYPES.has(resolutionType)) { const e = new Error("Invalid manual resolution type"); e.status = 400; throw e; }
  const operation = await getSyncOperationWithSteps(operationId);
  if (!operation) { const e = new Error("Sync operation not found for manual resolution"); e.status = 404; throw e; }
  const targetStep = stepId ? safeArray(operation.steps).find((step) => step.id === stepId) : pickVisibleStep(operation.steps);
  const [resolution] = await db.insert(manualSyncResolutions).values({ operationId, stepId: targetStep?.id || null, organizationId: organizationId || operation.logtoOrganizationId || operation.entityId || null, resolutionType, resolutionReason, resolvedByUserId, notes, appliesUntil: appliesUntil ? new Date(appliesUntil) : null, metadata: { sourceOfTruth: "civitas.operational_manual_decision", doesNotAssertProviderSuccess: true } }).returning();
  await recordOperationStep({ operationId, stepName: "manual_resolution.recorded", queueName: "owner-operational-center", jobId: resolution.id, status: STEP_STATUSES.COMPLETED, outputJson: { entityType: operation.entityType, targetIdentity: operation.entityId || operation.logtoOrganizationId, resolutionType, humanMessage: "Resolución manual registrada; no afirma éxito downstream", requiresHumanAction: false } });
  return { resolution, operation };
}

async function verifySyncOperationProvider({ operationId, organizationId, actorUserId = null }) {
  const operation = await getSyncOperationWithSteps(operationId).catch(() => null);
  const orgId = operation?.logtoOrganizationId || organizationId;
  const sourcePayload = safeObject(operation?.payloadSnapshotJson);
  const sourceResult = safeObject(operation?.resultSnapshotJson);
  const created = await createCanonicalSyncOperation({ operationType: "provider_verification", entityType: operation?.entityType || "provider.verification", entityId: operation?.entityId || orgId, logtoOrganizationId: orgId, logtoUserId: operation?.logtoUserId || sourcePayload.logtoUserId || null, correlationId: `owner-provider-verification:${operationId}:${Date.now()}`, idempotencyKey: `owner-provider-verification:${operationId}:${Date.now()}`, payloadSnapshotJson: { requestedFrom: "owner_console", requestedByUserId: actorUserId, verificationOfOperationId: operationId, provider: "logto_fluentcrm_wordpress", logtoOrganizationId: orgId, logtoUserId: operation?.logtoUserId || sourcePayload.logtoUserId || sourceResult?.workerOutcome?.result?.logtoUserId || null, email: sourcePayload.email || sourceResult?.workerOutcome?.result?.email || null, fluentcrmCompanyId: sourcePayload.fluentcrmCompanyId || sourceResult?.workerOutcome?.result?.fluentcrmCompanyId || null, humanMessage: "Verificación live de proveedor solicitada" } });
  const enqueueResult = await enqueueSyncOperation(created).catch((error) => ({ enqueued: false, reason: error.message, queueName: QUEUE_NAME, jobId: `sync-operation-${created.id}` }));
  await recordOperationStep({ operationId: created.id, stepName: "provider_verification.started", queueName: enqueueResult.queueName || QUEUE_NAME, jobId: enqueueResult.jobId || `sync-operation-${created.id}`, status: STEP_STATUSES.QUEUED, outputJson: { ...enqueueResult, entityType: created.entityType, targetIdentity: created.entityId, providerStatus: "queued_for_live_check", humanMessage: "Verificación live solicitada; el worker consultará Logto, FluentCRM y WordPress" } });
  return { operation: created, providerVerification: { status: "requested", level: "live_requested_not_local_projection", enqueueResult } };
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

const normalizeMicroAction = (stepName = "") => {
  const value = String(stepName || "");
  if (/detect_missing/.test(value)) return "detect_missing";
  if (/company\.create/.test(value)) return "create_company";
  if (/company\.patch/.test(value)) return "patch_company";
  if (/company\.ensure/.test(value)) return "ensure_company";
  if (/contact\.upsert/.test(value)) return "upsert_contact";
  if (/retry.*enqueue|retry_enqueued/.test(value)) return "retry_enqueued";
  if (/retry/.test(value)) return "retry";
  if (/branding/.test(value)) return "generate_branding";
  return value || "sync_operation";
};

const getOperationalRowType = ({ microAction = "", source = "", retryState = null, requiresHumanAction = false } = {}) => {
  if (/retry/.test(String(microAction)) || retryState) return "retry_event";
  if (requiresHumanAction) return "projected_pending";
  if (source === "sync_operation_step") return "operational_step";
  return "projected_pending";
};

function serializeStepOperationalLog({ operation, step, organizationName = null, workerHealth = {} }) {
  const output = safeObject(step?.outputJson);
  const lastError = safeObject(step?.lastErrorJson);
  const entityType = output.entityType || operation.entityType || null;
  const system = output.affectedSystem || output.system || (entityType?.includes("fluentcrm") ? "fluentcrm" : entityType?.includes("branding") ? "branding" : "sync");
  const queue = buildQueueProjection({ ...operation, workerHealth }, step);
  const metadata = {
    source: "sync_operation_step",
    operationId: operation.id,
    stepId: step.id,
    system,
    affectedSystem: system,
    microAction: normalizeMicroAction(step.stepName),
    stepName: step.stepName,
    entityType,
    targetIdentity: output.targetIdentity || operation.entityId || operation.logtoOrganizationId || null,
    humanMessage: safeFunctionalMessage(output.humanMessage || lastError.message || `${step.stepName} ${step.status}`),
    fieldsSent: output.fieldsSent || output.result?.fieldsSent || output.payloadSummary?.fieldsSent || [],
    missingFields: output.missingFields || output.result?.missingFields || output.payloadSummary?.missingFields || [],
    fieldDiffs: output.fieldDiffs || output.result?.fieldDiffs || null,
    providerCode: output.providerCode || output.code || lastError.code || null,
    providerStatus: output.providerStatus || output.status || lastError.status || step.status,
    queueName: queue.queueName,
    jobId: queue.jobId,
    retryState: deriveRetryState(operation, step),
    retryable: Boolean(lastError.retryable || output.retryable || ["failed", "partial_failed", "error"].includes(operation.status)),
    requiresHumanAction: Boolean(output.requiresHumanAction || lastError.requiresHumanAction || lastError.hitl),
    suggestedAction: output.suggestedAction || (lastError.retryable ? "Reintentar" : null),
    jobAgeSeconds: queue.jobAgeSeconds,
    workerHeartbeatState: queue.workerHeartbeatState,
  };
  const rowType = getOperationalRowType(metadata);
  return {
    id: `step-${step.id}`,
    rowType,
    actorUserId: null,
    actor: null,
    organizationId: operation.logtoOrganizationId || operation.entityId || null,
    organization: { id: operation.logtoOrganizationId || operation.entityId || null, name: organizationName },
    action: metadata.microAction,
    result: step.status,
    system: metadata.system,
    microAction: metadata.microAction,
    stepName: metadata.stepName,
    entityType: metadata.entityType,
    targetIdentity: metadata.targetIdentity,
    humanMessage: metadata.humanMessage,
    missingFields: metadata.missingFields,
    fieldDiffs: metadata.fieldDiffs,
    providerCode: metadata.providerCode,
    providerStatus: metadata.providerStatus,
    queueName: metadata.queueName,
    jobId: metadata.jobId,
    retryState: metadata.retryState,
    retryable: metadata.retryable,
    requiresHumanAction: metadata.requiresHumanAction,
    availableActions: [
      ...(metadata.retryable ? ["retry"] : []),
      ...(metadata.requiresHumanAction ? ["manual_review_required"] : []),
      "open_organization",
    ],
    metadata,
    createdAt: toIso(step.updatedAt || step.createdAt || operation.updatedAt),
  };
}

function serializeOperationOperationalLog({ operation, organizationName = null, workerHealth = {} }) {
  const pending = serializePending({ ...safeObject(operation), workerHealth }, organizationName);
  const metadata = {
    source: "sync_operation",
    operationId: operation.id,
    system: pending.affectedSystem,
    affectedSystem: pending.affectedSystem,
    microAction: normalizeMicroAction(pending.stepName || operation.operationType),
    stepName: pending.stepName || operation.operationType,
    entityType: pending.entityType,
    targetIdentity: pending.targetIdentity,
    humanMessage: pending.humanMessage || pending.lastError,
    fieldsSent: pending.fieldsSent,
    missingFields: pending.missingFields,
    fieldDiffs: pending.fieldDiffs,
    providerCode: pending.providerCode,
    providerStatus: pending.providerStatus,
    queueName: pending.queueName,
    jobId: pending.jobId,
    retryState: pending.retryState,
    retryable: pending.retryable,
    requiresHumanAction: pending.requiresHumanAction,
    suggestedAction: pending.suggestedAction,
    jobAgeSeconds: pending.jobAgeSeconds,
    workerHeartbeatState: pending.workerHeartbeatState,
  };
  const rowType = getOperationalRowType(metadata);
  return {
    id: `operation-${operation.id}`,
    rowType,
    actorUserId: null,
    actor: null,
    organizationId: pending.organizationId,
    organization: { id: pending.organizationId, name: organizationName },
    action: metadata.microAction,
    result: operation.status,
    system: metadata.system,
    microAction: metadata.microAction,
    stepName: metadata.stepName,
    entityType: metadata.entityType,
    targetIdentity: metadata.targetIdentity,
    humanMessage: metadata.humanMessage,
    missingFields: metadata.missingFields,
    fieldDiffs: metadata.fieldDiffs,
    providerCode: metadata.providerCode,
    providerStatus: metadata.providerStatus,
    queueName: metadata.queueName,
    jobId: metadata.jobId,
    retryState: metadata.retryState,
    retryable: metadata.retryable,
    requiresHumanAction: metadata.requiresHumanAction,
    availableActions: [
      ...(metadata.retryable ? ["retry"] : []),
      ...(metadata.requiresHumanAction ? ["manual_review_required"] : []),
      "open_organization",
    ],
    metadata,
    createdAt: toIso(operation.updatedAt || operation.createdAt),
  };
}

function operationalLogMatches(row, filters = {}) {
  row = safeObject(row);
  const metadata = safeObject(row.metadata);
  const includes = (value, expected) => !expected || String(value || "").toLowerCase().includes(String(expected).toLowerCase());
  if (!includes(row.organizationId, filters.organizationId)) return false;
  if (!includes(row.organization?.name, filters.organizationName)) return false;
  if (!includes(metadata.entityType, filters.entityType)) return false;
  if (!includes(metadata.stepName, filters.stepName)) return false;
  if (!includes(metadata.affectedSystem || metadata.system, filters.affectedSystem || filters.system)) return false;
  if (!includes(metadata.queueName, filters.queueName)) return false;
  if (!includes(metadata.microAction, filters.microAction)) return false;
  if (!includes(row.result, filters.status) && !includes(metadata.providerStatus, filters.status)) return false;
  if (!includes(metadata.retryState, filters.retryState)) return false;
  if (filters.retryable === "true" && !metadata.retryable) return false;
  if (filters.retryable === "false" && metadata.retryable) return false;
  if (filters.requiresHumanAction === "true" && !metadata.requiresHumanAction) return false;
  if (filters.requiresHumanAction === "false" && metadata.requiresHumanAction) return false;
  if (filters.requiresAction === "true" && !(metadata.requiresHumanAction || metadata.retryable || ["failed", "partial_failed", "error", "conflict"].includes(row.result))) return false;
  if (filters.requiresAction === "false" && (metadata.requiresHumanAction || metadata.retryable || ["failed", "partial_failed", "error", "conflict"].includes(row.result))) return false;
  if (filters.downstream === "true" && !/fluentcrm|wordpress|branding|downstream|sync/i.test(String(metadata.entityType || metadata.stepName || metadata.affectedSystem || metadata.system || row.action || ""))) return false;
  if (filters.q && !includes([metadata.humanMessage, metadata.stepName, metadata.entityType, metadata.targetIdentity, metadata.providerCode, row.action, row.organization?.name].filter(Boolean).join(" "), filters.q)) return false;
  const createdAt = new Date(row.createdAt || 0).getTime();
  const from = filters.from ? new Date(filters.from).getTime() : null;
  const to = filters.to ? new Date(filters.to).getTime() : null;
  if (from && Number.isFinite(from) && createdAt < from) return false;
  if (to && Number.isFinite(to) && createdAt > to) return false;
  return true;
}

function buildSerializationFallbackRow({ operation = {}, step = null, organizationName = null, error }) {
  const operationId = operation?.id || step?.operationId || null;
  const organizationId = operation?.logtoOrganizationId || operation?.entityId || null;
  const stepId = step?.id || null;
  const stepName = step?.stepName || operation?.operationType || "unknown";
  return {
    id: stepId ? `step-${stepId}-partial` : `operation-${operationId || Date.now()}-partial`,
    rowType: "serialization_partial",
    actorUserId: null,
    actor: null,
    organizationId,
    organization: { id: organizationId, name: organizationName },
    action: normalizeMicroAction(stepName),
    result: step?.status || operation?.status || "unknown",
    system: "sync",
    microAction: normalizeMicroAction(stepName),
    stepName,
    entityType: operation?.entityType || null,
    targetIdentity: operation?.entityId || organizationId,
    humanMessage: "Fila operativa parcial: datos legacy/corruptos no impiden cargar el centro operativo.",
    missingFields: [],
    fieldDiffs: null,
    retryable: false,
    requiresHumanAction: true,
    availableActions: ["open_organization", "manual_review_required"],
    metadata: { source: stepId ? "sync_operation_step" : "sync_operation", operationId, stepId, stepName, serializationError: error?.message || String(error || "unknown") },
    createdAt: toIso(step?.updatedAt || step?.createdAt || operation?.updatedAt || operation?.createdAt || new Date()),
  };
}

function pushOperationalRow(rows, context, serializer) {
  try {
    rows.push(serializer());
  } catch (error) {
    console.error("Failed to serialize operational log row", { operationId: context.operation?.id || context.step?.operationId || null, stepId: context.step?.id || null, organizationId: context.operation?.logtoOrganizationId || context.operation?.entityId || null, stepName: context.step?.stepName || context.operation?.operationType || null, error });
    rows.push(buildSerializationFallbackRow({ ...context, error }));
  }
}

function enrichOperationalRow(row) {
  const missingFields = safeArray(row.missingFields || row.metadata?.missingFields);
  const fieldDiffs = safeObject(row.fieldDiffs || row.metadata?.fieldDiffs);
  const hasDiffs = Object.keys(fieldDiffs).length > 0;
  let suggestedRoute = row.organizationId ? `/owner/organizations/${encodeURIComponent(row.organizationId)}` : null;
  let suggestedSection = "profile";
  let suggestedAction = row.metadata?.suggestedAction || row.suggestedAction || null;
  if (missingFields.some((field) => /logo|color|brand|css|favicon/i.test(String(field))) || /branding/i.test(String(row.entityType || row.stepName || ""))) { suggestedSection = "branding"; suggestedAction = suggestedAction || "Ir a branding"; }
  else if (/contact|member|user/i.test(String(row.entityType || row.stepName || ""))) { suggestedSection = "members"; suggestedAction = suggestedAction || "Ir a miembros"; }
  else if (missingFields.length || hasDiffs) { suggestedSection = "organization-profile"; suggestedAction = suggestedAction || "Corregir datos"; }
  const availableActions = new Set(safeArray(row.availableActions));
  if (row.retryable) availableActions.add("retry");
  if (row.organizationId) availableActions.add("open_organization");
  if (missingFields.length || hasDiffs) availableActions.add("correct_data");
  if (RESENDABLE_STEP_PATTERN.test(String(row.stepName || row.metadata?.stepName || ""))) availableActions.add("resend_payload");
  availableActions.add("verify_provider");
  if (row.requiresHumanAction) availableActions.add("manual_resolution");
  return { ...row, suggestedAction, suggestedRoute, suggestedSection, availableActions: [...availableActions], metadata: { ...safeObject(row.metadata), suggestedAction, suggestedRoute, suggestedSection } };
}

async function listOperationalLogs(filters = {}) {
  const limit = Math.min(Math.max(Number.parseInt(filters.limit, 10) || 25, 1), 100);
  const offset = Math.max(Number.parseInt(filters.offset, 10) || 0, 0);
  const scanLimit = Math.min(Math.max(Number.parseInt(filters.scanLimit, 10) || Number.parseInt(process.env.OWNER_OPERATIONAL_LOG_SCAN_LIMIT || "5000", 10), 100), 20000);
  const [recentOperations, openOperations, profiles, workerHealth] = await Promise.all([
    db.select().from(syncOperations).orderBy(desc(syncOperations.updatedAt)).limit(scanLimit),
    db.select().from(syncOperations).where(notInArray(syncOperations.status, [...TERMINAL_OPERATION_STATUSES])).orderBy(desc(syncOperations.updatedAt)).limit(20000),
    db.select().from(organizationProfiles).limit(500),
    getWorkerHealthSnapshot(),
  ]);
  const operationMap = new Map([...recentOperations, ...openOperations].map((operation) => [operation.id, operation]));
  const operations = [...operationMap.values()];
  const namesByOrg = new Map(profiles.map((profile) => [profile.logtoOrganizationId, profile.nameCache]).filter(([id]) => Boolean(id)));
  const withSteps = await Promise.all(operations.map((operation) => getSyncOperationWithSteps(operation.id).then((value) => value || { ...operation, steps: [] }).catch((error) => {
    console.error("Failed to load sync operation steps for operational logs", { operationId: operation.id, organizationId: operation.logtoOrganizationId, error });
    return { ...operation, steps: [], stepLoadError: error.message };
  })));
  const rows = [];
  for (const operation of withSteps) {
    const organizationName = namesByOrg.get(operation.logtoOrganizationId) || null;
    for (const step of safeArray(operation.steps)) {
      pushOperationalRow(rows, { operation, step, organizationName }, () => serializeStepOperationalLog({ operation, step, organizationName, workerHealth }));
    }
    pushOperationalRow(rows, { operation, organizationName }, () => serializeOperationOperationalLog({ operation, organizationName, workerHealth }));
  }
  const enrichedRows = rows.map(enrichOperationalRow);
  const sortedRows = enrichedRows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const filtered = sortedRows.filter((row) => { try { return operationalLogMatches(row, filters); } catch (error) { console.error("Failed to match operational log row", { rowId: row?.id, operationId: row?.metadata?.operationId, error }); return false; } });
  return {
    auditLogs: filtered.slice(offset, offset + limit),
    pagination: { limit, offset, total: filtered.length },
    source: {
      primary: "sync_operations+sync_operation_steps",
      administrativeEvents: "separate_audit_endpoint",
      workerState: "operationalObservability.workerHealthSnapshot",
      scanLimit,
      scope: "recent rows honor OWNER_OPERATIONAL_LOG_SCAN_LIMIT, and all non-terminal open operations are force-included so pending work is never hidden by age",
    },
  };
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
  listOperationalLogs,
  listOrganizationPendingSync,
  recordOperationStep,
  manualResolveSyncOperation,
  resendSyncOperationPayload,
  verifySyncOperationProvider,
  retrySyncOperation,
  safeFunctionalMessage,
  serializePending,
  updateSyncOperation,
};
