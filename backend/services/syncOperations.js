<<<<<<< HEAD
const { desc, eq } = require("drizzle-orm");
const { db } = require("../db/client");
const { syncOperations, syncOperationSteps, auditLogs } = require("../db/schema");
const { enqueueSyncOperation } = require("./syncQueue");

const TECHNICAL_ERROR_PATTERN = /(select|insert|update|delete|from|where|failed query|syntax error|relation .* does not exist|organization_bootstrap_micro_requests|SQLSTATE|postgres|duplicate key)/i;

function toIso(value) { return value?.toISOString?.() ?? value ?? null; }
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
  const c = classifyOperation(item);
  const rawError = item.lastError || item.errorMessage || null;
  return {
    id: item.id,
    operationId: item.operationId || item.id,
    organizationId: item.organizationId,
    organizationName,
    type: c.label,
    affectedSystem: c.system,
    status: item.status,
    retryable: Boolean(item.retryable || ["failed", "partial_failed", "error"].includes(item.status)),
    lastError: safeFunctionalMessage(rawError, c.system === "FluentCRM" ? "No se pudo completar la sincronización con FluentCRM. Logto conserva los datos canónicos." : undefined),
    technicalErrorPresent: Boolean(rawError && TECHNICAL_ERROR_PATTERN.test(rawError)),
    suggestedAction: c.action,
    metadata: item.metadata || null,
    createdAt: toIso(item.createdAt),
    updatedAt: toIso(item.updatedAt),
  };
}
async function createSyncOperation({ organizationId, operationType, metadata = {}, status = "queued", retryable = true, stepName = null, errorMessage = null }) {
  const [operation] = await db.insert(syncOperations).values({ organizationId, operationType, metadata, status, retryable, lastError: errorMessage, updatedAt: new Date() }).returning();
  if (stepName) await db.insert(syncOperationSteps).values({ operationId: operation.id, organizationId, stepName, status, retryable, errorMessage, metadata, updatedAt: new Date() });
  await enqueueSyncOperation(operation).catch((error) => console.error("Failed to enqueue sync operation", { operationId: operation.id, operationType, error }));
  return operation;
}
async function listOrganizationPendingSync({ organizationId }) {
  const [operations, steps] = await Promise.all([
    db.select().from(syncOperations).where(eq(syncOperations.organizationId, organizationId)).orderBy(desc(syncOperations.updatedAt)).limit(50),
    db.select().from(syncOperationSteps).where(eq(syncOperationSteps.organizationId, organizationId)).orderBy(desc(syncOperationSteps.updatedAt)).limit(50),
  ]);
  return [...operations.map((op) => serializePending(op)), ...steps.map((step) => serializePending(step))]
    .filter((item) => item.status !== "completed" && item.status !== "succeeded");
}
async function retrySyncOperation({ operationId, organizationId }) {
  const now = new Date();
  const [operation] = await db.update(syncOperations).set({ status: "queued", retryable: true, nextRetryAt: now, updatedAt: now }).where(eq(syncOperations.id, operationId)).returning();
  if (operation) {
    await enqueueSyncOperation(operation).catch((error) => console.error("Failed to enqueue sync retry", { operationId: operation.id, error }));
    return operation;
  }
  const [step] = await db.update(syncOperationSteps).set({ status: "queued", retryable: true, updatedAt: now }).where(eq(syncOperationSteps.id, operationId)).returning();
  if (step) return step;
  return createSyncOperation({ organizationId, operationType: "manual_retry", stepName: "manual_retry_requested", metadata: { requestedFrom: "owner_console", legacyCompatibility: "sync_operations_replaces_organization_bootstrap_micro_requests" } });
}
async function listOrganizationEvents({ organizationId, limit = 30 }) {
  const [ops, steps, logs] = await Promise.all([
    db.select().from(syncOperations).where(eq(syncOperations.organizationId, organizationId)).orderBy(desc(syncOperations.updatedAt)).limit(limit),
    db.select().from(syncOperationSteps).where(eq(syncOperationSteps.organizationId, organizationId)).orderBy(desc(syncOperationSteps.updatedAt)).limit(limit),
    db.select().from(auditLogs).where(eq(auditLogs.organizationId, organizationId)).orderBy(desc(auditLogs.createdAt)).limit(limit),
  ]);
  const events = [
    ...ops.map((op) => ({ id: `op-${op.id}`, at: toIso(op.updatedAt), type: classifyOperation(op).label, result: op.status, stage: op.operationType, message: serializePending(op).lastError, requiresAction: serializePending(op).retryable, retryOperationId: op.id })),
    ...steps.map((step) => ({ id: `step-${step.id}`, at: toIso(step.updatedAt), type: classifyOperation(step).label, result: step.status, stage: step.stepName, message: serializePending(step).lastError, requiresAction: serializePending(step).retryable, retryOperationId: step.id })),
    ...logs.map((log) => ({ id: `audit-${log.id}`, at: toIso(log.createdAt), type: "Evento administrativo", result: log.result, stage: log.action, message: safeFunctionalMessage(log.metadata?.message || log.metadata?.stage || log.action, "Evento registrado para esta organización."), requiresAction: log.result === "error", retryOperationId: null })),
  ];
  return events.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0)).slice(0, limit);
}
module.exports = { createSyncOperation, listOrganizationPendingSync, listOrganizationEvents, retrySyncOperation, safeFunctionalMessage };
=======
const { and, desc, eq } = require("drizzle-orm");
const { db } = require("../db/client");
const { syncOperationSteps, syncOperations } = require("../db/schema");

const OPERATION_STATUSES = Object.freeze({ QUEUED: "queued", RUNNING: "running", CANONICAL_COMPLETED: "canonical_completed", DOWNSTREAM_RUNNING: "downstream_running", PARTIAL_FAILED: "partial_failed", COMPLETED: "completed", FAILED: "failed" });
const PHASE_STATUSES = Object.freeze({ PENDING: "pending", RUNNING: "running", COMPLETED: "completed", FAILED: "failed", SKIPPED: "skipped" });
const STEP_STATUSES = Object.freeze({ QUEUED: "queued", RUNNING: "running", COMPLETED: "completed", FAILED: "failed", SKIPPED: "skipped" });
const safeJson = (value) => (value === undefined ? null : value);

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
  if (/redis|ECONNREFUSED|SocketClosed/i.test(message)) { system = "redis"; category = "redis_unavailable"; }
  if (/database|postgres|ECONNREFUSED/i.test(message)) { system = system === "redis" ? system : "database"; category = category === "redis_unavailable" ? category : "db_unavailable"; }
  if (status === 422 || code === "FLUENTCRM_VALIDATION_FAILED" || code === "FLUENTCRM_DUPLICATE_CONTACT") { system = "fluentcrm"; category = "validation_error"; retryable = false; }
  else if (/CONFIG|CONTRACT|MISMATCH|DUPLICATE|CONFLICT/i.test(String(code))) { category = /CONFLICT|DUPLICATE/.test(String(code)) ? "conflict" : "configuration_or_contract_error"; retryable = false; }
  else if (status === 401 || status === 403 || /AUTH/i.test(String(code))) { category = "auth_error"; retryable = false; }
  else if (status === 404 && system === "wordpress") { category = "route_or_catalog_error"; retryable = false; }
  else if (status >= 400 && status < 500) { category = "validation_error"; retryable = false; }
  else if (status >= 500 || /timeout|ETIMEDOUT|AbortError/i.test(message)) category = "timeout_or_remote_error";
  return { message, code, status: status || null, system, category, retryable, diagnostic: safeJson(error.diagnostic), body: safeJson(error.body), request: safeJson(error.request) };
}

async function createSyncOperation({ operationType, entityType, entityId = null, logtoOrganizationId = null, logtoUserId = null, correlationId, idempotencyKey, payloadSnapshotJson, database = db }) {
  const [existing] = idempotencyKey ? await database.select().from(syncOperations).where(eq(syncOperations.idempotencyKey, idempotencyKey)).limit(1) : [];
  if (existing) return existing;
  const [operation] = await database.insert(syncOperations).values({ operationType, entityType, entityId, logtoOrganizationId, logtoUserId, status: OPERATION_STATUSES.QUEUED, canonicalStatus: PHASE_STATUSES.PENDING, downstreamStatus: PHASE_STATUSES.PENDING, correlationId, idempotencyKey, payloadSnapshotJson: safeJson(payloadSnapshotJson), resultSnapshotJson: {}, retryCount: 0 }).returning();
  return operation;
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

async function recordOperationStep({ operationId, stepName, queueName, jobId, attempt = 1, status, outputJson = null, lastErrorJson = null }) {
  const now = new Date();
  const [existing] = await db.select().from(syncOperationSteps).where(and(eq(syncOperationSteps.operationId, operationId), eq(syncOperationSteps.stepName, stepName), eq(syncOperationSteps.attempt, attempt))).limit(1);
  if (existing) {
    const [updated] = await db.update(syncOperationSteps).set({ queueName, jobId: jobId ? String(jobId) : null, status, outputJson: safeJson(outputJson), lastErrorJson: safeJson(lastErrorJson), updatedAt: now, finishedAt: [STEP_STATUSES.COMPLETED, STEP_STATUSES.FAILED, STEP_STATUSES.SKIPPED].includes(status) ? now : null }).where(eq(syncOperationSteps.id, existing.id)).returning();
    return updated;
  }
  const [step] = await db.insert(syncOperationSteps).values({ operationId, stepName, queueName, jobId: jobId ? String(jobId) : null, attempt, status, outputJson: safeJson(outputJson), lastErrorJson: safeJson(lastErrorJson), startedAt: status === STEP_STATUSES.RUNNING ? now : null, finishedAt: [STEP_STATUSES.COMPLETED, STEP_STATUSES.FAILED, STEP_STATUSES.SKIPPED].includes(status) ? now : null }).returning();
  return step;
}

async function getSyncOperationWithSteps(id) {
  const [operation] = await db.select().from(syncOperations).where(eq(syncOperations.id, id)).limit(1);
  if (!operation) return null;
  const steps = await db.select().from(syncOperationSteps).where(eq(syncOperationSteps.operationId, id)).orderBy(syncOperationSteps.createdAt);
  return { ...operation, steps };
}

async function getLatestOperationForOrganization(logtoOrganizationId) {
  const [operation] = await db.select().from(syncOperations).where(eq(syncOperations.logtoOrganizationId, logtoOrganizationId)).orderBy(desc(syncOperations.createdAt)).limit(1);
  return operation ? getSyncOperationWithSteps(operation.id) : null;
}

module.exports = { OPERATION_STATUSES, PHASE_STATUSES, STEP_STATUSES, classifyOperationalError, createSyncOperation, getLatestOperationForOrganization, getSyncOperationWithSteps, recordOperationStep, updateSyncOperation };
>>>>>>> origin/main
