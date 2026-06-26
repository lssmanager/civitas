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

function classifyOperation(item = {}) {
  const type = item.stepName || item.operationType || "organization_sync";
  if (type.includes("contact")) return { label: "FluentCRM contact", system: "FluentCRM", action: "Reintentar contacto FluentCRM", entityType: "fluentcrm.contact" };
  if (type.includes("company") || type.includes("profile")) return { label: "FluentCRM company", system: "FluentCRM", action: "Reintentar company FluentCRM", entityType: "fluentcrm.company" };
  if (type.includes("branding.logto_css")) return { label: "Branding Logto CSS", system: "Logto", action: "Regenerar CSS de branding", entityType: "logto.branding_css" };
  if (type.includes("branding.logto")) return { label: "Branding Logto", system: "Logto", action: "Reintentar branding en Logto", entityType: "logto.branding" };
  if (type.includes("member")) return { label: "FluentCRM contact", system: "FluentCRM", action: "Reintentar contacto FluentCRM", entityType: "fluentcrm.contact" };
  if (type.includes("logto") && !type.includes("bootstrap")) return { label: "Logto", system: "Logto", action: "Reintentar operación Logto", entityType: "logto.organization" };
  return { label: "Sincronización operacional", system: "Downstream", action: "Reintentar solo este pendiente", entityType: "sync.operation" };
}

const TERMINAL_STEP_STATUSES = new Set([STEP_STATUSES.COMPLETED, STEP_STATUSES.SKIPPED]);
const FAILED_STEP_STATUSES = new Set([STEP_STATUSES.FAILED, "error", "partial_failed"]);
const DOWNSTREAM_STEP_PATTERN = /^(fluentcrm\.|branding\.logto|branding\.logto_css)/;

function getVisibleStep(item = {}) {
  const steps = Array.isArray(item.steps) ? item.steps : [];
  if (!steps.length) return null;
  const downstream = steps.filter((step) => DOWNSTREAM_STEP_PATTERN.test(step.stepName || ""));
  const candidates = downstream.length ? downstream : steps;
  return [...candidates].reverse().find((step) => !TERMINAL_STEP_STATUSES.has(step.status) || FAILED_STEP_STATUSES.has(step.status)) || candidates[candidates.length - 1] || null;
}

function buildQueueProjection(item = {}) {
  const step = getVisibleStep(item);
  const snapshot = item.jobSnapshot || {};
  const enqueuedAt = snapshot.enqueuedAt || toIso(step?.createdAt) || toIso(item.updatedAt) || toIso(item.createdAt);
  const workerHealth = item.workerHealth || {};
  return {
    queueName: snapshot.queueName || step?.queueName || QUEUE_NAME,
    jobId: snapshot.jobId || step?.jobId || (item.id ? `sync-operation-${item.id}` : null),
    retryState: snapshot.retryState || item.status,
    enqueuedAt,
    lastAttemptAt: snapshot.lastAttemptAt || toIso(step?.startedAt) || toIso(item.startedAt),
    workerHeartbeatState: workerHealth.worker?.heartbeatStale ? "stale" : workerHealth.worker?.heartbeatAt ? "active" : "unknown",
    jobAgeSeconds: snapshot.jobAgeSeconds ?? (enqueuedAt ? Math.max(0, Math.floor((Date.now() - new Date(enqueuedAt).getTime()) / 1000)) : null),
  };
}

function serializePending(item, organizationName = null) {
  const step = getVisibleStep(item);
  const classified = classifyOperation(step || item);
  const rawError = item.lastError || item.errorMessage || item.lastErrorJson?.message || step?.lastErrorJson?.message || item.humanMessage || null;
  const queue = buildQueueProjection(item);
  const humanMessage = item.humanMessage || item.payloadSnapshotJson?.humanMessage || item.resultSnapshotJson?.humanMessage || safeFunctionalMessage(
    rawError,
    classified.system === "FluentCRM"
      ? "No se pudo completar la sincronización con FluentCRM. Logto conserva los datos canónicos."
      : undefined
  );
  return {
    id: item.pendingId || item.id,
    operationId: item.operationId || item.id,
    organizationId: item.organizationId || item.logtoOrganizationId || item.entityId || null,
    organizationName,
    type: item.type || classified.label,
    operationType: item.operationType || null,
    affectedSystem: item.affectedSystem || classified.system,
    entityType: item.entityType || classified.entityType,
    targetIdentity: item.targetIdentity || item.logtoOrganizationId || item.entityId || null,
    stepName: item.stepName || step?.stepName || item.operationType,
    status: item.status,
    retryable: Boolean(item.retryable || item.lastErrorJson?.retryable || ["failed", "partial_failed", "error", "not_linked", "pending", "queued"].includes(item.status)),
    lastError: humanMessage,
    humanMessage,
    technicalErrorPresent: Boolean(rawError && TECHNICAL_ERROR_PATTERN.test(rawError)),
    suggestedAction: item.suggestedAction || classified.action,
    providerCode: item.providerCode || item.lastErrorJson?.code || step?.lastErrorJson?.code || null,
    providerStatus: item.providerStatus || item.lastErrorJson?.status || step?.lastErrorJson?.status || null,
    queueName: queue.queueName,
    jobId: queue.jobId,
    retryState: queue.retryState,
    enqueuedAt: queue.enqueuedAt,
    lastAttemptAt: queue.lastAttemptAt,
    workerHeartbeatState: queue.workerHeartbeatState,
    jobAgeSeconds: queue.jobAgeSeconds,
    fieldsSent: item.fieldsSent || item.payloadSnapshotJson?.fieldsSent || item.resultSnapshotJson?.fieldsSent || null,
    missingFields: item.missingFields || item.payloadSnapshotJson?.missingFields || item.resultSnapshotJson?.missingFields || [],
    fieldDiffs: item.fieldDiffs || item.payloadSnapshotJson?.fieldDiffs || item.resultSnapshotJson?.fieldDiffs || null,
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

function getCompanyPayloadSnapshot(profile = {}) {
  const settings = profile.settings || {};
  const business = settings.civitasProfile?.business || settings.business || {};
  const contact = settings.civitasProfile?.contact || settings.contact || {};
  return {
    name: profile.nameCache || business.name || null,
    state: business.state || business.department || null,
    city: business.city || null,
    postal_code: business.postalCode || business.postal_code || null,
    email: contact.email || business.email || null,
    phone: contact.phone || business.phone || null,
    website: business.website || null,
  };
}

function getMissingCompanyFields(profile = {}) {
  const payload = getCompanyPayloadSnapshot(profile);
  return ["state", "city", "postal_code"].filter((key) => !payload[key]);
}

function buildProjectedCrmPending(profile, latestOperation = null, workerHealth = {}) {
  if (!profile?.logtoOrganizationId) return null;
  const logtoOk = LOGTO_OK_STATUSES.has(profile.logtoSyncStatus) || Boolean(profile.logtoSyncedAt);
  if (!logtoOk || !CRM_PENDING_STATUSES.has(profile.fluentcrmSyncStatus)) return null;
  const fieldsSent = getCompanyPayloadSnapshot(profile);
  const missingFields = getMissingCompanyFields(profile);
  const stepName = profile.fluentcrmCompanyId ? "fluentcrm.company.patch" : "fluentcrm.company.ensure";
  const fieldDiffs = profile.fluentcrmCompanyId && profile.fluentcrmSyncStatus === "pending" ? { source: "logto.customData.civitasProfile", target: "fluentcrm.company", status: "pending_review" } : null;
  const humanMessage = missingFields.length
    ? `Faltan campos para crear/actualizar company: ${missingFields.join(", ")}`
    : !profile.fluentcrmCompanyId
      ? "Falta crear company en FluentCRM"
      : profile.fluentcrmSyncStatus === "error"
        ? "La company en FluentCRM falló al sincronizar"
        : profile.fluentcrmSyncStatus === "pending"
          ? "Hay cambios pendientes en FluentCRM company"
          : "Datos listos para reenviar a FluentCRM";
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
    suggestedAction: profile.fluentcrmCompanyId ? "Reenviar cambios a FluentCRM" : "Crear company en FluentCRM",
    providerCode: profile.fluentcrmSyncStatus === "not_linked" ? "FLUENTCRM_COMPANY_MISSING" : null,
    providerStatus: profile.fluentcrmSyncStatus,
    fieldsSent,
    missingFields,
    fieldDiffs,
    metadata: { fieldsSent, missingFields, fieldDiffs, fluentcrmCompanyId: profile.fluentcrmCompanyId, logtoStatus: profile.logtoSyncStatus, crmStatus: profile.fluentcrmSyncStatus },
    payloadSnapshotJson: { humanMessage, fieldsSent, missingFields, fieldDiffs, logtoStatus: profile.logtoSyncStatus, crmStatus: profile.fluentcrmSyncStatus },
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
    const operationWithSteps = await getSyncOperationWithSteps(operation.id).catch(() => null);
    const visibleStep = getVisibleStep(operationWithSteps || operation);
    const enqueueResult = await enqueueSyncOperation(operation).catch((error) => {
      console.error("Failed to enqueue sync retry", { operationId: operation.id, error });
      return { enqueued: false, reason: error.message };
    });
    await recordOperationStep({
      operationId: operation.id,
      stepName: visibleStep?.stepName || (operation.operationType?.includes("contact") ? "fluentcrm.contact.upsert:retry" : operation.operationType?.includes("company") || operation.operationType?.includes("profile") ? "fluentcrm.company.ensure" : "sync.retry.enqueue"),
      queueName: enqueueResult.queueName || QUEUE_NAME,
      jobId: enqueueResult.jobId || `sync-operation-${operation.id}`,
      status: STEP_STATUSES.QUEUED,
      outputJson: { ...enqueueResult, humanMessage: "Retry encolado para operación downstream" },
    });
    return operation;
  }

  return createLegacySyncOperation({
    organizationId,
    operationType: "manual_retry",
    stepName: "manual_retry_requested",
    metadata: { requestedFrom: "owner_console" },
  });
}

async function listOrganizationEvents({ organizationId, limit = 30 }) {
  const [ops, logs] = await Promise.all([
    db.select().from(syncOperations).where(eq(syncOperations.logtoOrganizationId, organizationId)).orderBy(desc(syncOperations.updatedAt)).limit(limit),
    db.select().from(auditLogs).where(eq(auditLogs.organizationId, organizationId)).orderBy(desc(auditLogs.createdAt)).limit(limit),
  ]);

  const operationEvents = await Promise.all(ops.map(async (op) => {
    const full = await getSyncOperationWithSteps(op.id);
    const pending = serializePending(full || op);
    return {
      id: `op-${op.id}`,
      at: toIso(op.updatedAt),
      type: pending.type,
      result: op.status,
      stage: pending.stepName || op.operationType,
      message: pending.humanMessage || pending.lastError,
      requiresAction: pending.retryable,
      retryOperationId: op.id,
      stepName: pending.stepName,
      entityType: pending.entityType,
      targetIdentity: pending.targetIdentity,
      queueName: pending.queueName,
      jobId: pending.jobId,
      retryState: pending.retryState,
      workerHeartbeatState: pending.workerHeartbeatState,
      jobAgeSeconds: pending.jobAgeSeconds,
    };
  }));

  const events = [
    ...operationEvents,
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
  updateSyncOperation,
};
