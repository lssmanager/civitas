const { and, desc, eq } = require("drizzle-orm");
const { db } = require("../db/client");
const { auditLogs, syncOperationSteps, syncOperations } = require("../db/schema");

let enqueueSyncOperation = async () => {};
try {
  ({ enqueueSyncOperation } = require("./syncQueue"));
} catch (_error) {
  enqueueSyncOperation = async () => {};
}

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
  const type = item.operationType || item.stepName || "organization_sync";
  if (type.includes("member")) return { label: "Sincronización de miembro", system: "FluentCRM", action: "Reintentar la propagación del miembro" };
  if (type.includes("contact")) return { label: "Sincronización de contacto", system: "FluentCRM", action: "Reintentar contacto específico" };
  if (type.includes("company") || type.includes("profile")) return { label: "Perfil organizacional", system: "FluentCRM", action: "Reenviar datos del perfil al CRM" };
  return { label: "Sincronización operacional", system: "Downstream", action: "Reintentar solo este pendiente" };
}

function serializePending(item, organizationName = null) {
  const classified = classifyOperation(item);
  const lastStep = Array.isArray(item.steps) ? item.steps[item.steps.length - 1] : null;
  const stepOutput = lastStep?.outputJson?.result || lastStep?.outputJson || {};
  const snapshot = item.resultSnapshotJson?.workerOutcome?.result || item.resultSnapshotJson || item.payloadSnapshotJson || {};
  const details = { ...snapshot, ...stepOutput };
  const rawError = item.lastError || item.errorMessage || item.lastErrorJson?.message || lastStep?.lastErrorJson?.message || null;
  const humanMessage = details.humanMessage || details.message || rawError || `${classified.label}: ${item.status}`;
  return {
    id: item.id,
    operationId: item.operationId || item.id,
    organizationId: item.organizationId || item.logtoOrganizationId || item.entityId || null,
    organizationName,
    type: classified.label,
    affectedSystem: classified.system,
    entityType: details.entityType || item.entityType || null,
    targetIdentity: details.targetIdentity || details.identity || null,
    fieldsSent: details.fieldsSent || details.payloadSummary?.fieldsSent || [],
    missingFields: details.missingFields || details.payloadSummary?.missingFields || [],
    fieldDiffs: details.fieldDiffs || null,
    providerStatus: details.providerStatus || details.status || null,
    providerCode: details.providerCode || details.code || null,
    humanMessage: safeFunctionalMessage(humanMessage),
    status: item.status,
    retryable: Boolean(item.retryable || item.lastErrorJson?.retryable || lastStep?.lastErrorJson?.retryable || ["failed", "partial_failed", "error"].includes(item.status)),
    lastError: safeFunctionalMessage(
      rawError,
      classified.system === "FluentCRM"
        ? "No se pudo completar la sincronización con FluentCRM. Logto conserva los datos canónicos."
        : undefined
    ),
    technicalErrorPresent: Boolean(rawError && TECHNICAL_ERROR_PATTERN.test(rawError)),
    suggestedAction: classified.action,
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
  const operations = await db.select().from(syncOperations)
    .where(eq(syncOperations.logtoOrganizationId, organizationId))
    .orderBy(desc(syncOperations.updatedAt))
    .limit(50);
  const operationsWithSteps = await Promise.all(operations.map((operation) => getSyncOperationWithSteps(operation.id).then((withSteps) => withSteps || operation)));

  return operationsWithSteps
    .map((operation) => serializePending(operation))
    .filter((item) => item.status !== "completed" && item.status !== "succeeded");
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
    await enqueueSyncOperation(operation).catch((error) =>
      console.error("Failed to enqueue sync retry", { operationId: operation.id, error })
    );
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

  const events = [
    ...ops.map((op) => ({
      id: `op-${op.id}`,
      at: toIso(op.updatedAt),
      type: classifyOperation(op).label,
      result: op.status,
      stage: op.operationType,
      message: serializePending(op).lastError,
      requiresAction: serializePending(op).retryable,
      retryOperationId: op.id,
    })),
    ...logs.map((log) => ({
      id: `audit-${log.id}`,
      at: toIso(log.createdAt),
      type: "Evento administrativo",
      result: log.result,
      stage: log.action,
      message: safeFunctionalMessage(log.metadata?.message || log.metadata?.stage || log.action, "Evento registrado para esta organización."),
      requiresAction: log.result === "error",
      retryOperationId: null,
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
