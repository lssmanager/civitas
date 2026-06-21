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
