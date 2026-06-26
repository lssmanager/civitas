const { eq } = require("drizzle-orm");
const { db } = require("../db/client");
const { syncOperations } = require("../db/schema");
const { AUDIT_ACTIONS, AUDIT_RESULTS, recordAuditLogBestEffort } = require("./auditLogs");
const { FluentCrmError, getOrCreateCompanyForOrganization, updateContactEmailAfterLogtoChange } = require("./fluentCrm");
const { getLogtoOrganizationById, createLogtoUserPasswordResetRequest } = require("./logtoManagement");
const { listOrganizationProfiles } = require("./organizationProfiles");
const { QUEUE_NAME, getSyncJobId } = require("./syncQueue");
const { STEP_STATUSES, recordOperationStep, safeFunctionalMessage } = require("./syncOperations");

const OPERATION_TYPES = Object.freeze({
  ORGANIZATION_PROFILE_DOWNSTREAM_SYNC: "organization_profile_downstream_sync",
  MEMBER_IDENTITY_DOWNSTREAM_SYNC: "member_identity_downstream_sync",
  MEMBER_RESET_PASSWORD: "member_reset_password",
  MANUAL_RETRY: "manual_retry",
});

const STEP_NAMES = Object.freeze({
  FLUENTCRM_COMPANY_ENSURE: "fluentcrm.company.ensure",
  FLUENTCRM_COMPANY_PATCH: "fluentcrm.company.patch",
  FLUENTCRM_CONTACT_UPSERT: "fluentcrm.contact.upsert:identity",
  BRANDING_LOGTO_PATCH: "branding.logto.patch",
  BRANDING_LOGTO_CSS_GENERATE: "branding.logto_css.generate",
  LOGTO_MEMBER_RESET_PASSWORD: "logto.member.reset_password",
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

const organizationIdFor = (operation) => operation.logtoOrganizationId || operation.entityId || null;

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
  return recordOperationStep({
    operationId: operation.id,
    stepName,
    queueName: metadata?.queueName || QUEUE_NAME,
    jobId: metadata?.jobId || getSyncJobId(operation),
    attempt: Number(operation.retryCount || 0) + 1,
    status,
    outputJson: metadata,
    lastErrorJson: errorMessage ? { message: errorMessage, retryable, code: metadata?.providerCode || metadata?.code || null, status: metadata?.providerStatus || metadata?.status || null } : null,
  });
}

async function getProfileForOperation(operation) {
  const organizationId = organizationIdFor(operation);
  const profiles = await listOrganizationProfiles();
  return profiles.find((profile) => profile.logtoOrganizationId === organizationId || profile.id === organizationId) || null;
}

async function processOrganizationProfileDownstreamSync(operation) {
  const organizationId = organizationIdFor(operation);
  const profile = await getProfileForOperation(operation);
  if (!profile) throw Object.assign(new Error("Organization profile not found for downstream sync"), { code: "INVALID_PAYLOAD" });
  const stepName = profile.fluentcrmCompanyId ? STEP_NAMES.FLUENTCRM_COMPANY_PATCH : STEP_NAMES.FLUENTCRM_COMPANY_ENSURE;
  await recordStep({ operation, stepName, status: STEP_STATUSES.RUNNING, metadata: { entityType: "fluentcrm.company", targetIdentity: profile.fluentcrmCompanyId || organizationId, humanMessage: `Worker inició ${profile.fluentcrmCompanyId ? "FluentCRM company patch" : "FluentCRM company sync"}` } });
  await recordAuditLogBestEffort({ organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_SYNC, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "retry started", stepName, entityType: "fluentcrm.company", targetIdentity: profile.fluentcrmCompanyId || organizationId, humanMessage: "Worker inició FluentCRM company sync", queueName: QUEUE_NAME, jobId: getSyncJobId(operation) } });
  const logtoOrganization = await getLogtoOrganizationById(profile.logtoOrganizationId || organizationId);
  const customData = logtoOrganization.customData || logtoOrganization.custom_data || {};
  const civitasProfile = customData.civitasProfile || {};
  const organizationSnapshot = { name: logtoOrganization.name || profile.nameCache, crm: { ...(civitasProfile.business || {}), ...(civitasProfile.contact || {}), ...(civitasProfile.branding || {}) } };
  const result = await getOrCreateCompanyForOrganization(profile, organizationSnapshot);
  const status = result.status === "conflict" ? "partial_failed" : "completed";
  const humanMessage = status === "completed" ? "FluentCRM company creada/actualizada correctamente" : safeFunctionalMessage(result.message, "FluentCRM company sync falló");
  if (status === "partial_failed") await updateOperation(operation.id, { status, downstreamStatus: "failed", lastErrorJson: { message: humanMessage, retryable: false, code: result.code || "FLUENTCRM_CONFLICT", status: result.status || null } });
  await recordStep({ operation, stepName, status: status === "completed" ? STEP_STATUSES.COMPLETED : STEP_STATUSES.FAILED, retryable: status !== "completed", errorMessage: status === "completed" ? null : humanMessage, metadata: { result, entityType: "fluentcrm.company", targetIdentity: result.companyId || profile.fluentcrmCompanyId || organizationId, humanMessage } });
  await recordAuditLogBestEffort({ organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_SYNC, result: status === "completed" ? AUDIT_RESULTS.SUCCESS : AUDIT_RESULTS.ERROR, metadata: { stage: status === "completed" ? "retry completed" : "retry failed", stepName, entityType: "fluentcrm.company", targetIdentity: result.companyId || profile.fluentcrmCompanyId || organizationId, humanMessage, providerCode: result.code || null, providerStatus: result.status || status, queueName: QUEUE_NAME, jobId: getSyncJobId(operation), result } });
  return { status, result, humanMessage };
}

async function processMemberIdentityDownstreamSync(operation) {
  const organizationId = organizationIdFor(operation);
  const metadata = operation.payloadSnapshotJson || {};
  await recordStep({ operation, stepName: STEP_NAMES.FLUENTCRM_CONTACT_UPSERT, status: STEP_STATUSES.RUNNING, metadata: { entityType: "fluentcrm.contact", targetIdentity: metadata.logtoUserId || metadata.email || null, humanMessage: "Worker inició FluentCRM contact sync" } });
  const result = await updateContactEmailAfterLogtoChange({ previousEmail: metadata.previousEmail || metadata.email, newEmail: metadata.email, logtoUserId: metadata.logtoUserId, logtoOrganizationId: organizationId, profile: { name: metadata.name, phone: metadata.phone } });
  await recordStep({ operation, stepName: STEP_NAMES.FLUENTCRM_CONTACT_UPSERT, status: STEP_STATUSES.COMPLETED, metadata: { result, entityType: "fluentcrm.contact", targetIdentity: metadata.logtoUserId || metadata.email || null, humanMessage: "FluentCRM contact actualizado correctamente" } });
  await recordAuditLogBestEffort({ organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_SYNC, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "retry completed", stepName: STEP_NAMES.FLUENTCRM_CONTACT_UPSERT, entityType: "fluentcrm.contact", targetIdentity: metadata.logtoUserId || metadata.email || null, humanMessage: "FluentCRM contact actualizado correctamente", queueName: QUEUE_NAME, jobId: getSyncJobId(operation), result } });
  return { status: "completed", result };
}

async function processMemberResetPassword(operation) {
  const organizationId = organizationIdFor(operation);
  const metadata = operation.payloadSnapshotJson || {};
  try {
    const result = await createLogtoUserPasswordResetRequest({ userId: metadata.logtoUserId });
    await recordStep({ operation, stepName: STEP_NAMES.LOGTO_MEMBER_RESET_PASSWORD, status: STEP_STATUSES.COMPLETED, metadata: { provider: "logto", result } });
    await recordAuditLogBestEffort({ organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "retry completed", stepName: STEP_NAMES.LOGTO_MEMBER_RESET_PASSWORD, entityType: "logto.user", targetIdentity: metadata.logtoUserId, humanMessage: "Reset password solicitado en Logto" } });
    return { status: "completed", result };
  } catch (error) {
    const unsupported = error.status === 404 || error.status === 405 || error.code === "LOGTO_UNSUPPORTED_CAPABILITY";
    const message = unsupported ? "Logto v1.40.1/configuración actual no expone un reset password administrativo seguro; no se creó reset local." : safeFunctionalMessage(error.message, "No se pudo solicitar reset password en Logto.");
    await recordStep({ operation, stepName: STEP_NAMES.LOGTO_MEMBER_RESET_PASSWORD, status: unsupported ? STEP_STATUSES.SKIPPED : STEP_STATUSES.FAILED, retryable: !unsupported, errorMessage: message, metadata: { provider: "logto", status: error.status || null, code: error.code || null } });
    await recordAuditLogBestEffort({ organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: unsupported ? AUDIT_RESULTS.SUCCESS : AUDIT_RESULTS.ERROR, metadata: { stage: unsupported ? "retry completed" : "retry failed", stepName: STEP_NAMES.LOGTO_MEMBER_RESET_PASSWORD, entityType: "logto.user", targetIdentity: metadata.logtoUserId, providerStatus: unsupported ? "unsupported" : "failed_safe", humanMessage: message } });
    return { status: unsupported ? "unsupported" : "failed_safe", retryable: !unsupported, message };
  }
}

async function processSyncOperation(operationOrId) {
  const operation = typeof operationOrId === "string" ? await loadOperation(operationOrId) : operationOrId;
  await updateOperation(operation.id, { status: "running", retryCount: Number(operation.retryCount || 0) + 1, startedAt: new Date() });
  try {
    let outcome;
    if (operation.operationType === OPERATION_TYPES.ORGANIZATION_PROFILE_DOWNSTREAM_SYNC) outcome = await processOrganizationProfileDownstreamSync(operation);
    else if (operation.operationType === OPERATION_TYPES.MEMBER_IDENTITY_DOWNSTREAM_SYNC) outcome = await processMemberIdentityDownstreamSync(operation);
    else if (operation.operationType === OPERATION_TYPES.MEMBER_RESET_PASSWORD) outcome = await processMemberResetPassword(operation);
    else if (operation.operationType === OPERATION_TYPES.MANUAL_RETRY) outcome = { status: "completed", result: { message: "Manual retry marker consumed; original operation should be retried separately when available." } };
    else throw Object.assign(new Error(`Unsupported sync operation type: ${operation.operationType}`), { code: "UNSUPPORTED_OPERATION_TYPE" });
    await updateOperation(operation.id, { status: outcome.status === "completed" ? "completed" : outcome.status === "partial_failed" ? "partial_failed" : outcome.status, downstreamStatus: outcome.status === "completed" ? "completed" : "failed", lastErrorJson: outcome.status === "completed" ? null : { message: outcome.message || outcome.humanMessage || null, retryable: Boolean(outcome.retryable) }, resultSnapshotJson: { ...(operation.resultSnapshotJson || {}), workerOutcome: outcome } });
    return outcome;
  } catch (error) {
    const classification = classifyError(error);
    const partial = error instanceof FluentCrmError || classification.category.startsWith("downstream") || classification.category === "timeout";
    const status = partial ? "partial_failed" : "failed";
    const stepName = operation.operationType === OPERATION_TYPES.MEMBER_IDENTITY_DOWNSTREAM_SYNC ? STEP_NAMES.FLUENTCRM_CONTACT_UPSERT : operation.operationType === OPERATION_TYPES.ORGANIZATION_PROFILE_DOWNSTREAM_SYNC ? STEP_NAMES.FLUENTCRM_COMPANY_ENSURE : `${operation.operationType}.failed`;
    const message = safeFunctionalMessage(error.message);
    await recordStep({ operation, stepName, status: STEP_STATUSES.FAILED, retryable: classification.retryable, errorMessage: message, metadata: { category: classification.category, code: error.code || null, status: error.status || null, providerCode: error.code || null, providerStatus: error.status || null, humanMessage: `FluentCRM sync falló por ${classification.category}` } });
    await updateOperation(operation.id, { status, downstreamStatus: "failed", lastErrorJson: { message, retryable: classification.retryable, code: error.code || null, status: error.status || null }, resultSnapshotJson: { ...(operation.resultSnapshotJson || {}), errorCategory: classification.category } });
    await recordAuditLogBestEffort({ organizationId: organizationIdFor(operation), action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_ERROR, result: AUDIT_RESULTS.ERROR, metadata: { stage: Number(operation.retryCount || 0) > 1 ? "retry failed again" : "retry failed", stepName, entityType: stepName.includes("contact") ? "fluentcrm.contact" : "fluentcrm.company", targetIdentity: organizationIdFor(operation), humanMessage: `FluentCRM sync falló por ${classification.category}`, providerCode: error.code || null, providerStatus: error.status || null, queueName: QUEUE_NAME, jobId: getSyncJobId(operation), operationId: operation.id, category: classification.category, status } });
    return { status, retryable: classification.retryable, errorCategory: classification.category, message };
  }
}

module.exports = { OPERATION_TYPES, STEP_NAMES, classifyError, processSyncOperation, processOrganizationProfileDownstreamSync, processMemberIdentityDownstreamSync, processMemberResetPassword };
