const { eq } = require("drizzle-orm");
const { db } = require("../db/client");
const { syncOperations } = require("../db/schema");
const { AUDIT_ACTIONS, AUDIT_RESULTS, recordAuditLogBestEffort } = require("./auditLogs");
const { FluentCrmError, getOrCreateCompanyForOrganization, upsertContactFromLogtoIdentity } = require("./fluentCrm");
const { getLogtoOrganizationById, createLogtoUserPasswordResetRequest, listLogtoOrganizationUserRoles } = require("./logtoManagement");
const { listOrganizationProfiles } = require("./organizationProfiles");
const { QUEUE_NAME, getSyncJobId } = require("./syncQueue");
const { STEP_STATUSES, recordOperationStep, safeFunctionalMessage, updateSyncOperation } = require("./syncOperations");

const OPERATION_TYPES = Object.freeze({
  ORGANIZATION_PROFILE_DOWNSTREAM_SYNC: "organization_profile_downstream_sync",
  MEMBER_IDENTITY_DOWNSTREAM_SYNC: "member_identity_downstream_sync",
  MEMBER_RESET_PASSWORD: "member_reset_password",
  MANUAL_RETRY: "manual_retry",
});

const STEP_NAMES = Object.freeze({
  FLUENTCRM_COMPANY_DETECT_MISSING: "fluentcrm.company.detect_missing",
  FLUENTCRM_COMPANY_ENSURE: "fluentcrm.company.ensure",
  FLUENTCRM_COMPANY_CREATE: "fluentcrm.company.create",
  FLUENTCRM_COMPANY_PATCH: "fluentcrm.company.patch",
  FLUENTCRM_CONTACT_UPSERT: "fluentcrm.contact.upsert:identity",
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
  const stepName = profile.fluentcrmCompanyId ? STEP_NAMES.FLUENTCRM_COMPANY_PATCH : STEP_NAMES.FLUENTCRM_COMPANY_CREATE;
  if (!profile.fluentcrmCompanyId) await recordStep({ operation, stepName: STEP_NAMES.FLUENTCRM_COMPANY_DETECT_MISSING, status: STEP_STATUSES.COMPLETED, metadata: { entityType: "fluentcrm.company", affectedSystem: "FluentCRM", targetIdentity: organizationId, humanMessage: "FluentCRM company detectada como faltante", suggestedAction: "Reintentar create company", retryable: true } });
  await recordStep({ operation, stepName, status: STEP_STATUSES.RUNNING, metadata: { entityType: "fluentcrm.company", targetIdentity: profile.fluentcrmCompanyId || organizationId, humanMessage: `Worker inició ${profile.fluentcrmCompanyId ? "FluentCRM company patch" : "create company"}`, affectedSystem: "FluentCRM", suggestedAction: profile.fluentcrmCompanyId ? "Reenviar datos a CRM" : "Reintentar create company", retryable: true } });
  await recordAuditLogBestEffort({ organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_SYNC, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "retry started", stepName, entityType: "fluentcrm.company", targetIdentity: profile.fluentcrmCompanyId || organizationId, humanMessage: profile.fluentcrmCompanyId ? "Worker inició FluentCRM company patch" : "Worker inició create company", affectedSystem: "FluentCRM", suggestedAction: profile.fluentcrmCompanyId ? "Reenviar datos a CRM" : "Reintentar create company", retryable: true, queueName: QUEUE_NAME, jobId: getSyncJobId(operation) } });
  const logtoOrganization = await getLogtoOrganizationById(profile.logtoOrganizationId || organizationId);
  const customData = logtoOrganization.customData || logtoOrganization.custom_data || {};
  const civitasProfile = customData.civitasProfile || {};
  const organizationSnapshot = { name: logtoOrganization.name || profile.nameCache, crm: { ...(civitasProfile.business || {}), ...(civitasProfile.contact || {}), ...(civitasProfile.branding || {}) } };
  const result = await getOrCreateCompanyForOrganization(profile, organizationSnapshot);
  const status = result.status === "conflict" ? "partial_failed" : "completed";
  const humanMessage = status === "completed" ? (profile.fluentcrmCompanyId ? "FluentCRM company actualizada correctamente" : "Create company completado") : safeFunctionalMessage(result.message, "FluentCRM company sync falló");
  if (status === "partial_failed") await updateOperation(operation.id, { status, downstreamStatus: "failed", lastErrorJson: { message: humanMessage, retryable: false, code: result.code || "FLUENTCRM_CONFLICT", status: result.status || null } });
  await recordStep({ operation, stepName, status: status === "completed" ? STEP_STATUSES.COMPLETED : STEP_STATUSES.FAILED, retryable: status !== "completed", errorMessage: status === "completed" ? null : humanMessage, metadata: { result, affectedSystem: "FluentCRM", entityType: "fluentcrm.company", targetIdentity: result.companyId || profile.fluentcrmCompanyId || organizationId, humanMessage } });
  await recordAuditLogBestEffort({ organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_SYNC, result: status === "completed" ? AUDIT_RESULTS.SUCCESS : AUDIT_RESULTS.ERROR, metadata: { affectedSystem: "FluentCRM", stage: status === "completed" ? "retry completed" : "retry failed", stepName, entityType: "fluentcrm.company", targetIdentity: result.companyId || profile.fluentcrmCompanyId || organizationId, humanMessage, providerCode: result.code || null, providerStatus: result.status || status, queueName: QUEUE_NAME, jobId: getSyncJobId(operation), result } });
  return { status, result, humanMessage };
}

async function processMemberIdentityDownstreamSync(operation) {
  const organizationId = organizationIdFor(operation);
  const metadata = operationPayload(operation);
  const targetIdentity = metadata.logtoUserId || metadata.email || null;
  await recordStep({ operation, stepName: STEP_NAMES.FLUENTCRM_CONTACT_UPSERT, status: STEP_STATUSES.RUNNING, metadata: { entityType: "fluentcrm.contact", targetIdentity, humanMessage: "Worker inició FluentCRM contact upsert" } });

  const profile = await getProfileForOperation(operation);
  const companyId = metadata.companyId || metadata.fluentcrmCompanyId || profile?.fluentcrmCompanyId || null;
  if (!companyId) throw new FluentCrmError("Organization is not linked to a FluentCRM company", { code: "FLUENTCRM_COMPANY_NOT_LINKED", status: 409, body: { message: "company_not_linked" } });

  const roleNames = Array.isArray(metadata.roleNames)
    ? metadata.roleNames.filter(Boolean)
    : metadata.logtoUserId
      ? (await listLogtoOrganizationUserRoles({ organizationId, userId: metadata.logtoUserId })).map((role) => role.name || role.nameCache || role.key || role.organizationRoleName).filter(Boolean)
      : [];
  const identity = {
    logtoUserId: metadata.logtoUserId || null,
    logtoOrganizationId: metadata.logtoOrganizationId || organizationId,
    email: metadata.newEmail || metadata.email || null,
    previousEmail: metadata.previousEmail || null,
    name: metadata.name || metadata.fullName || null,
    firstName: metadata.firstName || metadata.givenName || null,
    middleName: metadata.middleName || null,
    lastName: metadata.lastName || metadata.familyName || null,
    username: metadata.username || null,
    phone: metadata.phone || metadata.primaryPhone || null,
    position: metadata.position || metadata.jobTitle || null,
  };
  const result = await upsertContactFromLogtoIdentity({ identity, companyId, roleNames });
  const completed = ["created", "updated"].includes(result.status);
  const status = completed ? "completed" : result.status === "conflict" ? "partial_failed" : "partial_failed";
  const humanMessage = completed ? "FluentCRM contact sincronizado correctamente" : safeFunctionalMessage(result.message || result.reason, "FluentCRM contact sync requiere revisión");
  await recordStep({ operation, stepName: STEP_NAMES.FLUENTCRM_CONTACT_UPSERT, status: completed ? STEP_STATUSES.COMPLETED : STEP_STATUSES.FAILED, retryable: false, errorMessage: completed ? null : humanMessage, metadata: { result, entityType: "fluentcrm.contact", targetIdentity, humanMessage, companyId, roleNames } });
  await recordAuditLogBestEffort({ organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_SYNC, result: completed ? AUDIT_RESULTS.SUCCESS : AUDIT_RESULTS.ERROR, metadata: { stage: completed ? "retry completed" : "retry partial_failed", stepName: STEP_NAMES.FLUENTCRM_CONTACT_UPSERT, entityType: "fluentcrm.contact", targetIdentity, humanMessage, queueName: QUEUE_NAME, jobId: getSyncJobId(operation), result } });
  return { status, result, humanMessage, retryable: false };
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
    const stepName = operation.operationType === OPERATION_TYPES.MEMBER_IDENTITY_DOWNSTREAM_SYNC ? STEP_NAMES.FLUENTCRM_CONTACT_UPSERT : operation.operationType === OPERATION_TYPES.ORGANIZATION_PROFILE_DOWNSTREAM_SYNC ? STEP_NAMES.FLUENTCRM_COMPANY_CREATE : `${operation.operationType}.failed`;
    const message = safeFunctionalMessage(error.message);
    await recordStep({ operation, stepName, status: STEP_STATUSES.FAILED, retryable: classification.retryable, errorMessage: message, metadata: { category: classification.category, code: error.code || null, status: error.status || null, providerCode: error.code || null, providerStatus: error.status || null, humanMessage: `FluentCRM sync falló por ${classification.category}` } });
    await updateOperation(operation.id, { status, downstreamStatus: "failed", lastErrorJson: { message, retryable: classification.retryable, code: error.code || null, status: error.status || null }, resultSnapshotJson: { ...(operation.resultSnapshotJson || {}), errorCategory: classification.category } });
    await recordAuditLogBestEffort({ organizationId: organizationIdFor(operation), action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_ERROR, result: AUDIT_RESULTS.ERROR, metadata: { stage: "retry failed", stepName, entityType: stepName.includes("contact") ? "fluentcrm.contact" : "fluentcrm.company", targetIdentity: organizationIdFor(operation), humanMessage: `FluentCRM sync falló por ${classification.category}`, providerCode: error.code || null, providerStatus: error.status || null, queueName: QUEUE_NAME, jobId: getSyncJobId(operation), operationId: operation.id, category: classification.category, status } });
    return { status, retryable: classification.retryable, errorCategory: classification.category, message };
  }
}

module.exports = { OPERATION_TYPES, STEP_NAMES, classifyError, processSyncOperation, processOrganizationProfileDownstreamSync, processMemberIdentityDownstreamSync, processMemberResetPassword };
