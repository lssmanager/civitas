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
