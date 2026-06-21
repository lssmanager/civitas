const { eq } = require("drizzle-orm");
const { db } = require("../db/client");
const { syncOperations, syncOperationSteps } = require("../db/schema");
const { AUDIT_ACTIONS, AUDIT_RESULTS, recordAuditLogBestEffort } = require("./auditLogs");
const { FluentCrmError, getOrCreateCompanyForOrganization, updateContactEmailAfterLogtoChange } = require("./fluentCrm");
const { getLogtoOrganizationById, createLogtoUserPasswordResetRequest } = require("./logtoManagement");
const { listOrganizationProfiles } = require("./organizationProfiles");
const { safeFunctionalMessage } = require("./syncOperations");

const OPERATION_TYPES = Object.freeze({
  ORGANIZATION_PROFILE_DOWNSTREAM_SYNC: "organization_profile_downstream_sync",
  MEMBER_IDENTITY_DOWNSTREAM_SYNC: "member_identity_downstream_sync",
  MEMBER_RESET_PASSWORD: "member_reset_password",
  MANUAL_RETRY: "manual_retry",
});

function classifyError(error) {
  const code = error?.code || "UNKNOWN";
  const status = error?.status || null;
  if (code.includes("TIMEOUT") || error?.name === "AbortError") return { category: "timeout", retryable: true };
  if (code.includes("CONFIG")) return { category: "configuration", retryable: false };
  if (status === 401 || status === 403 || code.includes("AUTH")) return { category: "auth", retryable: false };
  if (code.includes("CONFLICT") || status === 409) return { category: "downstream_conflict", retryable: false };
  if (status === 400 || status === 422 || code.includes("INVALID")) return { category: "invalid_payload", retryable: false };
  if (code.includes("UNSUPPORTED")) return { category: "unsupported_capability", retryable: false };
  return { category: "downstream_error", retryable: true };
}

async function loadOperation(operationId) {
  const [operation] = await db.select().from(syncOperations).where(eq(syncOperations.id, operationId)).limit(1);
  if (!operation) throw Object.assign(new Error(`Sync operation not found: ${operationId}`), { code: "SYNC_OPERATION_NOT_FOUND", status: 404 });
  return operation;
}

async function updateOperation(operationId, patch) {
  const [row] = await db.update(syncOperations).set({ ...patch, updatedAt: new Date() }).where(eq(syncOperations.id, operationId)).returning();
  return row;
}

async function recordStep({ operation, stepName, status, retryable = false, errorMessage = null, metadata = null }) {
  const [step] = await db.insert(syncOperationSteps).values({ operationId: operation.id, organizationId: operation.organizationId, stepName, status, retryable, errorMessage, metadata, startedAt: status === "running" ? new Date() : null, completedAt: ["completed", "failed", "unsupported"].includes(status) ? new Date() : null, updatedAt: new Date() }).returning();
  return step;
}

async function getProfileForOperation(operation) {
  const profiles = await listOrganizationProfiles();
  return profiles.find((profile) => profile.logtoOrganizationId === operation.organizationId || profile.id === operation.organizationId) || null;
}

async function processOrganizationProfileDownstreamSync(operation) {
  await recordStep({ operation, stepName: "fluentcrm_company_profile_sync", status: "running", metadata: { contract: "Logto customData.civitasProfile -> FluentCRM Company" } });
  const profile = await getProfileForOperation(operation);
  if (!profile) throw Object.assign(new Error("Organization profile not found for downstream sync"), { code: "INVALID_PAYLOAD" });
  const logtoOrganization = await getLogtoOrganizationById(profile.logtoOrganizationId || operation.organizationId);
  const customData = logtoOrganization.customData || logtoOrganization.custom_data || {};
  const civitasProfile = customData.civitasProfile || {};
  const organizationSnapshot = { name: logtoOrganization.name || profile.nameCache, crm: { ...(civitasProfile.business || {}), ...(civitasProfile.contact || {}), ...(civitasProfile.branding || {}) } };
  const result = await getOrCreateCompanyForOrganization(profile, organizationSnapshot);
  const status = result.status === "conflict" ? "partial_failed" : "completed";
  if (status === "partial_failed") await updateOperation(operation.id, { status, retryable: false, lastError: result.message || "Conflicto downstream con FluentCRM" });
  await recordStep({ operation, stepName: "fluentcrm_company_profile_sync", status: status === "completed" ? "completed" : "failed", retryable: status !== "completed", errorMessage: status === "completed" ? null : result.message, metadata: { result } });
  await recordAuditLogBestEffort({ organizationId: operation.organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_SYNC, result: status === "completed" ? AUDIT_RESULTS.SUCCESS : AUDIT_RESULTS.ERROR, metadata: { stage: "worker.organization_profile_downstream_sync", operationId: operation.id, result } });
  return { status, result };
}

async function processMemberIdentityDownstreamSync(operation) {
  await recordStep({ operation, stepName: "fluentcrm_contact_identity_sync", status: "running", metadata: { contract: "Logto identity already updated -> FluentCRM Contact" } });
  const metadata = operation.metadata || {};
  const result = await updateContactEmailAfterLogtoChange({ previousEmail: metadata.previousEmail || metadata.email, newEmail: metadata.email, logtoUserId: metadata.logtoUserId, logtoOrganizationId: operation.organizationId, profile: { name: metadata.name, phone: metadata.phone } });
  await recordStep({ operation, stepName: "fluentcrm_contact_identity_sync", status: "completed", metadata: { result } });
  await recordAuditLogBestEffort({ organizationId: operation.organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_SYNC, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "worker.member_identity_downstream_sync", operationId: operation.id, logtoUserId: metadata.logtoUserId, result } });
  return { status: "completed", result };
}

async function processMemberResetPassword(operation) {
  await recordStep({ operation, stepName: "logto_member_reset_password", status: "running", metadata: { contract: "Logto v1.40.1 provider capability only; no local reset" } });
  const metadata = operation.metadata || {};
  try {
    const result = await createLogtoUserPasswordResetRequest({ userId: metadata.logtoUserId });
    await recordStep({ operation, stepName: "logto_member_reset_password", status: "completed", metadata: { provider: "logto", result } });
    await recordAuditLogBestEffort({ organizationId: operation.organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "worker.member_reset_password", operationId: operation.id, provider: "logto" } });
    return { status: "completed", result };
  } catch (error) {
    const unsupported = error.status === 404 || error.status === 405 || error.code === "LOGTO_UNSUPPORTED_CAPABILITY";
    const message = unsupported ? "Logto v1.40.1/configuración actual no expone un reset password administrativo seguro; no se creó reset local." : safeFunctionalMessage(error.message, "No se pudo solicitar reset password en Logto.");
    await recordStep({ operation, stepName: "logto_member_reset_password", status: unsupported ? "unsupported" : "failed", retryable: !unsupported, errorMessage: message, metadata: { provider: "logto", status: error.status || null, code: error.code || null } });
    await recordAuditLogBestEffort({ organizationId: operation.organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: unsupported ? AUDIT_RESULTS.SUCCESS : AUDIT_RESULTS.ERROR, metadata: { stage: "worker.member_reset_password", operationId: operation.id, providerStatus: unsupported ? "unsupported" : "failed_safe", message } });
    return { status: unsupported ? "unsupported" : "failed_safe", retryable: !unsupported, message };
  }
}

async function processSyncOperation(operationOrId) {
  const operation = typeof operationOrId === "string" ? await loadOperation(operationOrId) : operationOrId;
  await updateOperation(operation.id, { status: "running", attempts: (operation.attempts || 0) + 1 });
  try {
    let outcome;
    if (operation.operationType === OPERATION_TYPES.ORGANIZATION_PROFILE_DOWNSTREAM_SYNC) outcome = await processOrganizationProfileDownstreamSync(operation);
    else if (operation.operationType === OPERATION_TYPES.MEMBER_IDENTITY_DOWNSTREAM_SYNC) outcome = await processMemberIdentityDownstreamSync(operation);
    else if (operation.operationType === OPERATION_TYPES.MEMBER_RESET_PASSWORD) outcome = await processMemberResetPassword(operation);
    else if (operation.operationType === OPERATION_TYPES.MANUAL_RETRY) outcome = { status: "completed", result: { message: "Manual retry marker consumed; original operation should be retried separately when available." } };
    else throw Object.assign(new Error(`Unsupported sync operation type: ${operation.operationType}`), { code: "UNSUPPORTED_OPERATION_TYPE" });
    await updateOperation(operation.id, { status: outcome.status === "completed" ? "completed" : outcome.status === "partial_failed" ? "partial_failed" : outcome.status, retryable: Boolean(outcome.retryable), lastError: outcome.status === "completed" ? null : outcome.message || null, metadata: { ...(operation.metadata || {}), workerOutcome: outcome } });
    return outcome;
  } catch (error) {
    const classification = classifyError(error);
    const partial = error instanceof FluentCrmError || classification.category.startsWith("downstream") || classification.category === "timeout";
    const status = partial ? "partial_failed" : "failed";
    await recordStep({ operation, stepName: `${operation.operationType}_failed`, status: "failed", retryable: classification.retryable, errorMessage: safeFunctionalMessage(error.message), metadata: { category: classification.category, code: error.code || null, status: error.status || null } });
    await updateOperation(operation.id, { status, retryable: classification.retryable, lastError: safeFunctionalMessage(error.message), metadata: { ...(operation.metadata || {}), errorCategory: classification.category } });
    await recordAuditLogBestEffort({ organizationId: operation.organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_ERROR, result: AUDIT_RESULTS.ERROR, metadata: { stage: `worker.${operation.operationType}`, operationId: operation.id, category: classification.category, status } });
    return { status, retryable: classification.retryable, errorCategory: classification.category, message: safeFunctionalMessage(error.message) };
  }
}

module.exports = { OPERATION_TYPES, classifyError, processSyncOperation, processOrganizationProfileDownstreamSync, processMemberIdentityDownstreamSync, processMemberResetPassword };
