const { eq } = require("drizzle-orm");
const { db } = require("../db/client");
const { syncOperations } = require("../db/schema");
const { AUDIT_ACTIONS, AUDIT_RESULTS, recordAuditLogBestEffort } = require("./auditLogs");
const { FluentCrmError, syncCompanyFromLogtoOrganization, upsertContactFromLogtoIdentity, updateContactEmailAfterLogtoChange } = require("./fluentCrm");
const { getLogtoOrganizationById, createLogtoUserPasswordResetRequest } = require("./logtoManagement");
const { listOrganizationProfiles } = require("./organizationProfiles");
const { recordOperationStep, safeFunctionalMessage, updateSyncOperation } = require("./syncOperations");

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
  return updateSyncOperation({ id: operationId, ...patch });
}

function operationOrganizationId(operation = {}) {
  return operation.logtoOrganizationId || operation.entityId || operation.organizationId || null;
}

function operationPayload(operation = {}) {
  return operation.payloadSnapshotJson || operation.metadata || {};
}

async function recordStep({ operation, stepName, status, retryable = false, errorMessage = null, metadata = null }) {
  return recordOperationStep({
    operationId: operation.id,
    stepName,
    queueName: "sync-operation-processor",
    jobId: operation.id,
    attempt: Math.max(1, Number(operation.retryCount || 0) + 1),
    status,
    outputJson: metadata,
    lastErrorJson: errorMessage ? { message: errorMessage, retryable } : null,
  });
}

async function getProfileForOperation(operation) {
  const profiles = await listOrganizationProfiles();
  return profiles.find((profile) => profile.logtoOrganizationId === operationOrganizationId(operation) || profile.id === operationOrganizationId(operation)) || null;
}

async function processOrganizationProfileDownstreamSync(operation) {
  await recordStep({ operation, stepName: "fluentcrm_company_profile_sync", status: "running", metadata: { contract: "Logto customData.civitasProfile -> FluentCRM Company" } });
  const profile = await getProfileForOperation(operation);
  if (!profile) throw Object.assign(new Error("Organization profile not found for downstream sync"), { code: "INVALID_PAYLOAD" });
  const logtoOrganization = await getLogtoOrganizationById(profile.logtoOrganizationId || operationOrganizationId(operation));
  const result = await syncCompanyFromLogtoOrganization({ profile, logtoOrganization });
  const status = result.status === "conflict" || result.status === "error" ? "partial_failed" : "completed";
  if (status === "partial_failed") await updateOperation(operation.id, { status, downstreamStatus: "failed", lastErrorJson: { message: result.humanMessage || "Conflicto downstream con FluentCRM", retryable: false, providerCode: result.providerCode || null } });
  await recordStep({ operation, stepName: "fluentcrm_company_profile_sync", status: status === "completed" ? "completed" : "failed", retryable: status !== "completed", errorMessage: status === "completed" ? null : result.humanMessage, metadata: { result } });
  await recordAuditLogBestEffort({ organizationId: operationOrganizationId(operation), action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_SYNC, result: status === "completed" ? AUDIT_RESULTS.SUCCESS : AUDIT_RESULTS.ERROR, metadata: { stage: "worker.organization_profile_downstream_sync", operationId: operation.id, result } });
  return { status, result };
}

async function processMemberIdentityDownstreamSync(operation) {
  await recordStep({ operation, stepName: "fluentcrm_contact_identity_sync", status: "running", metadata: { contract: "Logto identity/customData + membership role -> FluentCRM Contact" } });
  const metadata = operationPayload(operation);
  const profile = await getProfileForOperation(operation);
  const roleNames = [metadata.organizationRoleName, metadata.roleName, ...(Array.isArray(metadata.roleNames) ? metadata.roleNames : [])].filter(Boolean);
  const identity = {
    logtoUserId: metadata.logtoUserId,
    logtoOrganizationId: operationOrganizationId(operation),
    email: metadata.email,
    previousEmail: metadata.previousEmail,
    name: metadata.name,
    firstName: metadata.firstName || metadata.primerNombre,
    middleName: metadata.middleName || metadata.segundoNombre,
    firstSurname: metadata.firstSurname || metadata.primerApellido,
    secondSurname: metadata.secondSurname || metadata.segundoApellido,
    username: metadata.username,
    phone: metadata.phone,
    position: metadata.position,
    phoneExtension: metadata.phoneExtension,
    lastLoginAt: metadata.lastLoginAt,
  };
  if (!profile?.fluentcrmCompanyId) {
    const result = { status: "error", reason: "company_not_linked", entityType: "contact", targetIdentity: { email: metadata.email || null, logtoUserId: metadata.logtoUserId || null }, payloadSummary: null, fieldsSent: [], missingFields: ["company_id"], providerStatus: "blocked", providerCode: "missing_company_id", humanMessage: `Contacto ${metadata.email || metadata.logtoUserId || "sin identidad"}: falta company_id` };
    await recordStep({ operation, stepName: "fluentcrm_contact_identity_sync", status: "failed", retryable: true, errorMessage: result.humanMessage, metadata: { result } });
    return { status: "partial_failed", retryable: true, message: result.humanMessage, result };
  }
  if (roleNames.length === 0) {
    const result = { status: "error", reason: "missing_user_role", entityType: "contact", targetIdentity: { email: metadata.email || null, logtoUserId: metadata.logtoUserId || null }, payloadSummary: null, fieldsSent: [], missingFields: ["user_role"], providerStatus: "blocked", providerCode: "missing_user_role", humanMessage: `Contacto ${metadata.email || metadata.logtoUserId || "sin identidad"}: falta user_role` };
    await recordStep({ operation, stepName: "fluentcrm_contact_identity_sync", status: "failed", retryable: false, errorMessage: result.humanMessage, metadata: { result } });
    return { status: "partial_failed", retryable: false, message: result.humanMessage, result };
  }
  try {
    const crmResult = await upsertContactFromLogtoIdentity({ identity, companyId: profile.fluentcrmCompanyId, roleNames });
    const result = { ...crmResult, entityType: "contact", targetIdentity: { email: crmResult.email || metadata.email || null, logtoUserId: metadata.logtoUserId || null }, providerStatus: crmResult.status, providerCode: crmResult.reason || null, humanMessage: `Contacto ${crmResult.email || metadata.email}: enviado ${crmResult.fieldsSent?.join(", ") || "sin campos"}` };
    await recordStep({ operation, stepName: "fluentcrm_contact_identity_sync", status: "completed", metadata: { result } });
    await recordAuditLogBestEffort({ organizationId: operationOrganizationId(operation), action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_SYNC, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "worker.member_identity_downstream_sync", operationId: operation.id, logtoUserId: metadata.logtoUserId, result } });
    return { status: "completed", result };
  } catch (error) {
    const diagnostic = error.crmContactSync || {};
    const result = { ...diagnostic, entityType: "contact", targetIdentity: { email: diagnostic.email || metadata.email || null, logtoUserId: metadata.logtoUserId || null }, providerStatus: "error", providerCode: diagnostic.code || error.code || null, humanMessage: `Contacto ${diagnostic.email || metadata.email || metadata.logtoUserId || "sin identidad"}: ${diagnostic.reason || error.message}` };
    await recordStep({ operation, stepName: "fluentcrm_contact_identity_sync", status: "failed", retryable: false, errorMessage: result.humanMessage, metadata: { result } });
    return { status: "partial_failed", retryable: false, message: result.humanMessage, result };
  }
}

async function processMemberResetPassword(operation) {
  await recordStep({ operation, stepName: "logto_member_reset_password", status: "running", metadata: { contract: "Logto v1.40.1 provider capability only; no local reset" } });
  const metadata = operationPayload(operation);
  try {
    const result = await createLogtoUserPasswordResetRequest({ userId: metadata.logtoUserId });
    await recordStep({ operation, stepName: "logto_member_reset_password", status: "completed", metadata: { provider: "logto", result } });
    await recordAuditLogBestEffort({ organizationId: operationOrganizationId(operation), action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "worker.member_reset_password", operationId: operation.id, provider: "logto" } });
    return { status: "completed", result };
  } catch (error) {
    const unsupported = error.status === 404 || error.status === 405 || error.code === "LOGTO_UNSUPPORTED_CAPABILITY";
    const message = unsupported ? "Logto v1.40.1/configuración actual no expone un reset password administrativo seguro; no se creó reset local." : safeFunctionalMessage(error.message, "No se pudo solicitar reset password en Logto.");
    await recordStep({ operation, stepName: "logto_member_reset_password", status: unsupported ? "unsupported" : "failed", retryable: !unsupported, errorMessage: message, metadata: { provider: "logto", status: error.status || null, code: error.code || null } });
    await recordAuditLogBestEffort({ organizationId: operationOrganizationId(operation), action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: unsupported ? AUDIT_RESULTS.SUCCESS : AUDIT_RESULTS.ERROR, metadata: { stage: "worker.member_reset_password", operationId: operation.id, providerStatus: unsupported ? "unsupported" : "failed_safe", message } });
    return { status: unsupported ? "unsupported" : "failed_safe", retryable: !unsupported, message };
  }
}

async function processSyncOperation(operationOrId) {
  const operation = typeof operationOrId === "string" ? await loadOperation(operationOrId) : operationOrId;
  await updateOperation(operation.id, { status: "running", downstreamStatus: "running", retryCount: (operation.retryCount || 0) + 1, startedAt: operation.startedAt || new Date() });
  try {
    let outcome;
    if (operation.operationType === OPERATION_TYPES.ORGANIZATION_PROFILE_DOWNSTREAM_SYNC) outcome = await processOrganizationProfileDownstreamSync(operation);
    else if (operation.operationType === OPERATION_TYPES.MEMBER_IDENTITY_DOWNSTREAM_SYNC) outcome = await processMemberIdentityDownstreamSync(operation);
    else if (operation.operationType === OPERATION_TYPES.MEMBER_RESET_PASSWORD) outcome = await processMemberResetPassword(operation);
    else if (operation.operationType === OPERATION_TYPES.MANUAL_RETRY) outcome = { status: "completed", result: { message: "Manual retry marker consumed; original operation should be retried separately when available." } };
    else throw Object.assign(new Error(`Unsupported sync operation type: ${operation.operationType}`), { code: "UNSUPPORTED_OPERATION_TYPE" });
    await updateOperation(operation.id, { status: outcome.status === "completed" ? "completed" : outcome.status === "partial_failed" ? "partial_failed" : outcome.status, downstreamStatus: outcome.status === "completed" ? "completed" : "failed", resultSnapshotJson: { ...(operation.resultSnapshotJson || {}), workerOutcome: outcome }, lastErrorJson: outcome.status === "completed" ? null : { message: outcome.message || "Sync operation did not complete", retryable: Boolean(outcome.retryable) } });
    return outcome;
  } catch (error) {
    const classification = classifyError(error);
    const partial = error instanceof FluentCrmError || classification.category.startsWith("downstream") || classification.category === "timeout";
    const status = partial ? "partial_failed" : "failed";
    await recordStep({ operation, stepName: `${operation.operationType}_failed`, status: "failed", retryable: classification.retryable, errorMessage: safeFunctionalMessage(error.message), metadata: { ...(error.crmCompanySync ? { result: error.crmCompanySync } : {}), category: classification.category, code: error.code || null, status: error.status || null } });
    await updateOperation(operation.id, { status, downstreamStatus: "failed", lastErrorJson: { message: safeFunctionalMessage(error.message), retryable: classification.retryable, category: classification.category }, resultSnapshotJson: { ...(operation.resultSnapshotJson || {}), errorCategory: classification.category } });
    await recordAuditLogBestEffort({ organizationId: operationOrganizationId(operation), action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_ERROR, result: AUDIT_RESULTS.ERROR, metadata: { stage: `worker.${operation.operationType}`, operationId: operation.id, category: classification.category, status } });
    return { status, retryable: classification.retryable, errorCategory: classification.category, message: safeFunctionalMessage(error.message) };
  }
}

module.exports = { OPERATION_TYPES, classifyError, processSyncOperation, processOrganizationProfileDownstreamSync, processMemberIdentityDownstreamSync, processMemberResetPassword };
