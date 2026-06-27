const { eq } = require("drizzle-orm");
const { db } = require("../db/client");
const { syncOperations } = require("../db/schema");
const { AUDIT_ACTIONS, AUDIT_RESULTS, recordAuditLogBestEffort } = require("./auditLogs");
const { FluentCrmError, getOrCreateCompanyForOrganization, searchCompanies, searchContacts, upsertContactFromLogtoIdentity } = require("./fluentCrm");
const { getLogtoOrganizationById, getLogtoUserById, createLogtoUserPasswordResetRequest, listLogtoOrganizationUserRoles, listLogtoOrganizationUsers } = require("./logtoManagement");
const { listOrganizationProfiles } = require("./organizationProfiles");
const { QUEUE_NAME, getSyncJobId } = require("./syncQueue");
const { STEP_STATUSES, recordOperationStep, safeFunctionalMessage, updateSyncOperation } = require("./syncOperations");

const OPERATION_TYPES = Object.freeze({
  ORGANIZATION_PROFILE_DOWNSTREAM_SYNC: "organization_profile_downstream_sync",
  MEMBER_IDENTITY_DOWNSTREAM_SYNC: "member_identity_downstream_sync",
  MEMBER_RESET_PASSWORD: "member_reset_password",
  MANUAL_RETRY: "manual_retry",
  PROVIDER_VERIFICATION: "provider_verification",
});

const STEP_NAMES = Object.freeze({
  FLUENTCRM_COMPANY_DETECT_MISSING: "fluentcrm.company.detect_missing",
  FLUENTCRM_COMPANY_ENSURE: "fluentcrm.company.ensure",
  FLUENTCRM_COMPANY_CREATE: "fluentcrm.company.create",
  FLUENTCRM_COMPANY_PATCH: "fluentcrm.company.patch",
  FLUENTCRM_CONTACT_UPSERT: "fluentcrm.contact.upsert:identity",
  LOGTO_MEMBER_RESET_PASSWORD: "logto.member.reset_password",
  PROVIDER_VERIFICATION: "provider_verification.live",
  PROVIDER_VERIFICATION_TAKEN: "provider_verification.taken_by_worker",
  PROVIDER_VERIFICATION_LOGTO: "provider_verification.logto_check_started",
  PROVIDER_VERIFICATION_FLUENTCRM: "provider_verification.fluentcrm_check_started",
  PROVIDER_VERIFICATION_WORDPRESS: "provider_verification.wordpress_check_started",
  PROVIDER_VERIFICATION_COMPLETED: "provider_verification.completed",
  PROVIDER_VERIFICATION_PARTIAL_FAILED: "provider_verification.partial_failed",
  PROVIDER_VERIFICATION_FAILED: "provider_verification.failed",
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


function classifyMemberContactRecoveryState(result = {}) {
  const code = result.code || result.reason || "";
  const status = Number(result.fluentCrmStatus || result.statusCode || 0);
  const message = result.message || "";
  if (["created", "updated"].includes(result.status)) return { retryState: "completed", retryable: false, requiresHumanAction: false, suggestedAction: null };
  if (result.status === "conflict" || /duplicate|conflict/i.test(String(code))) return { retryState: "manual_retry_required", retryable: false, requiresHumanAction: true, suggestedAction: "Resolver duplicado en FluentCRM y reintentar manualmente" };
  if (status === 422 || /VALIDATION|INVALID|missing_email|payload/i.test(String(code))) return { retryState: "human_action_required", retryable: false, requiresHumanAction: true, suggestedAction: "Corregir payload/datos requeridos antes de reintentar" };
  if (/TIMEOUT|timeout|AbortError|ETIMEDOUT/i.test(`${code} ${message}`) || status >= 500) return { retryState: "retry_pending", retryable: true, requiresHumanAction: false, suggestedAction: "Retry automático pendiente" };
  return { retryState: result.status === "error" ? "manual_retry_required" : "not_required", retryable: result.status === "error", requiresHumanAction: false, suggestedAction: result.status === "error" ? "Reintentar sincronización de contacto" : null };
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
  await recordStep({ operation, stepName: "fluentcrm_company.taken_by_worker", status: STEP_STATUSES.RUNNING, metadata: { entityType: "fluentcrm.company", targetIdentity: profile.fluentcrmCompanyId || organizationId, humanMessage: "Worker tomó retry de FluentCRM company", providerStatus: "taken_by_worker" } });
  await recordStep({ operation, stepName: "fluentcrm_company.retry_running", status: STEP_STATUSES.RUNNING, metadata: { entityType: "fluentcrm.company", targetIdentity: profile.fluentcrmCompanyId || organizationId, humanMessage: "Retry de FluentCRM company en ejecución", providerStatus: "retry_running" } });
  if (!profile.fluentcrmCompanyId) await recordStep({ operation, stepName: STEP_NAMES.FLUENTCRM_COMPANY_DETECT_MISSING, status: STEP_STATUSES.COMPLETED, metadata: { entityType: "fluentcrm.company", affectedSystem: "FluentCRM", targetIdentity: organizationId, humanMessage: "FluentCRM company detectada como faltante", suggestedAction: "Reintentar create company", retryable: true } });
  await recordStep({ operation, stepName: "fluentcrm_company.live_request_started", status: STEP_STATUSES.RUNNING, metadata: { entityType: "fluentcrm.company", targetIdentity: profile.fluentcrmCompanyId || organizationId, humanMessage: "Solicitud live a FluentCRM iniciada", providerStatus: "live_request_started" } });
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
  await recordStep({ operation, stepName: status === "completed" ? "fluentcrm_company.completed" : "fluentcrm_company.failed", status: status === "completed" ? STEP_STATUSES.COMPLETED : STEP_STATUSES.FAILED, retryable: status !== "completed", errorMessage: status === "completed" ? null : humanMessage, metadata: { result, affectedSystem: "FluentCRM", entityType: "fluentcrm.company", targetIdentity: result.companyId || profile.fluentcrmCompanyId || organizationId, humanMessage, providerCode: result.code || result.providerCode || null, providerStatus: result.status || result.providerStatus || status } });
  if (status !== "completed") await recordStep({ operation, stepName: "contacts_not_started", status: STEP_STATUSES.SKIPPED, metadata: { entityType: "fluentcrm.contact", targetIdentity: organizationId, reason: "company_sync_failed", contactsStatus: "not_started_due_to_company_failure", providerCode: result.code || result.providerCode || null, providerStatus: result.status || result.providerStatus || status, humanMessage: "Contactos no iniciados porque la Company de FluentCRM no quedó lista.", suggestedAction: "Reintentar sincronización de company" } });
  await recordStep({ operation, stepName, status: status === "completed" ? STEP_STATUSES.COMPLETED : STEP_STATUSES.FAILED, retryable: status !== "completed", errorMessage: status === "completed" ? null : humanMessage, metadata: { result, affectedSystem: "FluentCRM", entityType: "fluentcrm.company", targetIdentity: result.companyId || profile.fluentcrmCompanyId || organizationId, humanMessage } });
  await recordAuditLogBestEffort({ organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_SYNC, result: status === "completed" ? AUDIT_RESULTS.SUCCESS : AUDIT_RESULTS.ERROR, metadata: { affectedSystem: "FluentCRM", stage: status === "completed" ? "retry completed" : "retry failed", stepName, entityType: "fluentcrm.company", targetIdentity: result.companyId || profile.fluentcrmCompanyId || organizationId, humanMessage, providerCode: result.code || null, providerStatus: result.status || status, queueName: QUEUE_NAME, jobId: getSyncJobId(operation), result } });
  return { status, result, humanMessage };
}


function normalizeEmailForVerification(value) {
  return value ? String(value).trim().toLowerCase() || null : null;
}

function getContactWpUserId(contact = {}) {
  const custom = contact.custom_values || contact.customValues || {};
  return contact.wp_user_id || contact.wpUserId || contact.user_id || contact.userId || custom.wp_user_id || custom.wpUserId || custom.wordpress_user_id || null;
}

function getWordPressConfig() {
  const baseUrl = process.env.WORDPRESS_BASE_URL || process.env.FLUENTCRM_BASE_URL || null;
  const username = process.env.WORDPRESS_USERNAME || process.env.FLUENTCRM_USERNAME || null;
  const appPassword = process.env.WORDPRESS_APP_PASSWORD || process.env.FLUENTCRM_APP_PASSWORD || null;
  if (!baseUrl || !username || !appPassword) return null;
  return { baseUrl: String(baseUrl).replace(/\/+$/, ""), username, appPassword, timeoutMs: Number.parseInt(process.env.WORDPRESS_TIMEOUT_MS || process.env.FLUENTCRM_TIMEOUT_MS || "10000", 10) || 10000 };
}

async function findWordPressUserByEmail(email, fetchImpl = fetch) {
  const normalizedEmail = normalizeEmailForVerification(email);
  const config = getWordPressConfig();
  if (!normalizedEmail || !config) return { configured: Boolean(config), user: null, status: config ? "missing_email" : "not_configured" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const url = new URL(`${config.baseUrl}/wp-json/wp/v2/users`);
  url.searchParams.set("search", normalizedEmail);
  url.searchParams.set("context", "edit");
  try {
    const response = await fetchImpl(url, { headers: { authorization: `Basic ${Buffer.from(`${config.username}:${config.appPassword}`).toString("base64")}`, accept: "application/json" }, signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error("WordPress user verification request failed");
      error.status = response.status;
      error.code = response.status === 401 ? "WORDPRESS_AUTHENTICATION_FAILED" : response.status === 403 ? "WORDPRESS_AUTHORIZATION_FAILED" : response.status === 404 ? "WORDPRESS_ENDPOINT_NOT_FOUND" : "WORDPRESS_USER_LOOKUP_FAILED";
      throw error;
    }
    const users = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
    const user = users.find((item) => normalizeEmailForVerification(item.email || item.user_email) === normalizedEmail) || users[0] || null;
    return { configured: true, user, status: user ? "found" : "not_found" };
  } catch (error) {
    if (error.name === "AbortError") Object.assign(error, { code: "WORDPRESS_TIMEOUT" });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildVerificationConclusion(checks = {}) {
  const failures = [];
  if (checks.providerTimeout) return { status: "provider_timeout", providerCode: "PROVIDER_TIMEOUT", providerStatus: "timeout", humanMessage: "La verificación live expiró consultando un proveedor.", nextAction: "retry", availableActions: ["retry", "verify_provider"], retryable: true };
  if (checks.providerAuthError) return { status: "provider_auth_error", providerCode: checks.providerAuthCode || "PROVIDER_AUTH_ERROR", providerStatus: checks.providerAuthStatus || "auth_error", humanMessage: "No se pudo autenticar contra uno de los proveedores durante la verificación live.", nextAction: "open_settings", availableActions: ["open_settings", "verify_provider"], retryable: false };
  if (checks.providerConflictDetected) failures.push("provider_conflict_detected");
  if (checks.logtoOrganizationExists === false || checks.logtoMembershipValid === false) failures.push("missing_logto_membership");
  if (checks.fluentcrmCompanyExists === false) failures.push("missing_fluentcrm_company");
  if (checks.fluentcrmCompanyExists && (checks.fluentcrmContactExists === false || checks.fluentcrmContactBelongsToCompany === false)) failures.push("missing_fluentcrm_contact");
  if (checks.wordpressUserExists === false) failures.push("awaiting_first_wordpress_login");
  if (checks.wordpressUserExists && checks.fluentcrmContactExists && checks.contactLinkedToWpUser === false) failures.push("missing_contact_wp_link");
  const status = failures[0] || "all_ok";
  const messages = { all_ok: "Verificación live OK: Logto, FluentCRM y WordPress están consistentes.", missing_logto_membership: "Falta membresía válida en Logto para el usuario/organización verificados.", missing_fluentcrm_company: "Falta Company en FluentCRM; Logto puede estar correcto pero downstream no está completo.", missing_fluentcrm_contact: "Falta contacto en FluentCRM para el usuario verificado o no está asociado a la Company correcta.", awaiting_first_wordpress_login: "Usuario WordPress aún no existe; estado esperado si el usuario no ha hecho primer login.", missing_contact_wp_link: "Existe usuario WordPress, pero el contacto FluentCRM no está enlazado al wp_user_id.", provider_conflict_detected: "Se detectó conflicto o duplicado en los proveedores verificados." };
  const nextActions = { all_ok: "open_organization", missing_logto_membership: "open_organization", missing_fluentcrm_company: "retry_company", missing_fluentcrm_contact: "retry_contacts", awaiting_first_wordpress_login: "open_organization", missing_contact_wp_link: "verify_provider", provider_conflict_detected: "verify_provider" };
  const actionsByStatus = {
    all_ok: ["open_organization", "verify_provider"],
    missing_logto_membership: ["open_organization", "verify_provider"],
    missing_fluentcrm_company: ["retry_company", "open_organization", "verify_provider"],
    missing_fluentcrm_contact: ["retry_contacts", "open_members", "verify_provider"],
    awaiting_first_wordpress_login: ["open_organization", "verify_provider"],
    missing_contact_wp_link: ["verify_provider", "manual_reconcile"],
    provider_conflict_detected: ["verify_provider", "manual_reconcile"],
  };
  return { status, providerCode: status.toUpperCase(), providerStatus: status, humanMessage: messages[status], nextAction: nextActions[status], availableActions: actionsByStatus[status] || [nextActions[status], "verify_provider"], retryable: ["missing_fluentcrm_company", "missing_fluentcrm_contact"].includes(status), failures };
}

async function processProviderVerification(operation) {
  const organizationId = organizationIdFor(operation);
  const metadata = operationPayload(operation);
  await recordStep({ operation, stepName: STEP_NAMES.PROVIDER_VERIFICATION_TAKEN, status: STEP_STATUSES.RUNNING, metadata: { entityType: "provider.verification", targetIdentity: organizationId, providerStatus: "taken_by_worker", humanMessage: "Worker tomó provider_verification" } });
  await recordStep({ operation, stepName: STEP_NAMES.PROVIDER_VERIFICATION, status: STEP_STATUSES.RUNNING, metadata: { entityType: "provider.verification", targetIdentity: organizationId, providerStatus: "live_check_running", humanMessage: "Worker inició verificación live contra Logto, FluentCRM y WordPress" } });
  const checks = { source: "live_provider_verification", checkedAt: new Date().toISOString(), logtoOrganizationId: organizationId, logtoUserId: metadata.logtoUserId || operation.logtoUserId || null, email: normalizeEmailForVerification(metadata.email) };
  try {
    await recordStep({ operation, stepName: STEP_NAMES.PROVIDER_VERIFICATION_LOGTO, status: STEP_STATUSES.RUNNING, metadata: { entityType: "logto.organization", targetIdentity: organizationId, providerStatus: "logto_check_started", humanMessage: "Verificación live Logto iniciada" } });
    const logtoOrganization = await getLogtoOrganizationById(organizationId).catch((error) => { if (error.status === 404) return null; throw error; });
    checks.logtoOrganizationExists = Boolean(logtoOrganization);
    let logtoUser = checks.logtoUserId ? await getLogtoUserById(checks.logtoUserId).catch((error) => { if (error.status === 404) return null; throw error; }) : null;
    checks.logtoUserExists = checks.logtoUserId ? Boolean(logtoUser) : null;
    if (!checks.email) checks.email = normalizeEmailForVerification(logtoUser?.primaryEmail || logtoUser?.email || logtoUser?.profile?.email);
    const members = logtoOrganization ? await listLogtoOrganizationUsers({ organizationId }).catch((error) => { if (error.status === 404) return []; throw error; }) : [];
    const member = checks.logtoUserId ? members.find((item) => (item.id || item.userId || item.logtoUserId || item.sub) === checks.logtoUserId) : checks.email ? members.find((item) => normalizeEmailForVerification(item.primaryEmail || item.email || item.profile?.email) === checks.email) : null;
    checks.logtoMembershipValid = checks.logtoUserId || checks.email ? Boolean(member) : null;
    if (!checks.logtoUserId && member) checks.logtoUserId = member.id || member.userId || member.logtoUserId || member.sub || null;
    const roles = checks.logtoUserId ? await listLogtoOrganizationUserRoles({ organizationId, userId: checks.logtoUserId }).catch(() => []) : [];
    checks.organizationRolesResolved = checks.logtoUserId ? Array.isArray(roles) : null;
    await recordStep({ operation, stepName: STEP_NAMES.PROVIDER_VERIFICATION_LOGTO, status: STEP_STATUSES.COMPLETED, metadata: { entityType: "logto.organization", targetIdentity: organizationId, providerStatus: "logto_check_completed", humanMessage: "Verificación live Logto completada", logtoOrganizationExists: checks.logtoOrganizationExists, logtoMembershipValid: checks.logtoMembershipValid, organizationRolesResolved: checks.organizationRolesResolved } });
    await recordStep({ operation, stepName: STEP_NAMES.PROVIDER_VERIFICATION_FLUENTCRM, status: STEP_STATUSES.RUNNING, metadata: { entityType: "fluentcrm", targetIdentity: organizationId, providerStatus: "fluentcrm_check_started", humanMessage: "Verificación live FluentCRM iniciada" } });
    const profile = await getProfileForOperation(operation).catch(() => null);
    const companyId = metadata.fluentcrmCompanyId || metadata.companyId || profile?.fluentcrmCompanyId || null;
    const companies = companyId ? await searchCompanies({ companyId }) : [];
    checks.fluentcrmCompanyExists = companyId ? companies.length === 1 : false;
    checks.fluentcrmCompanyId = companies[0]?.id || companies[0]?.ID || companyId || null;
    const contacts = checks.email || checks.logtoUserId ? await searchContacts({ email: checks.email, externalId: checks.logtoUserId }) : [];
    checks.providerConflictDetected = contacts.length > 1 || companies.length > 1;
    const contact = contacts[0] || null;
    checks.fluentcrmContactExists = Boolean(contact);
    checks.fluentcrmContactId = contact?.id || contact?.ID || null;
    const contactCompanyId = contact?.company_id || contact?.companyId || contact?.company?.id || null;
    checks.fluentcrmContactBelongsToCompany = contact ? String(contactCompanyId || "") === String(checks.fluentcrmCompanyId || companyId || "") : false;
    await recordStep({ operation, stepName: STEP_NAMES.PROVIDER_VERIFICATION_FLUENTCRM, status: STEP_STATUSES.COMPLETED, metadata: { entityType: "fluentcrm", targetIdentity: organizationId, providerStatus: "fluentcrm_check_completed", humanMessage: "Verificación live FluentCRM completada", fluentcrmCompanyExists: checks.fluentcrmCompanyExists, fluentcrmCompanyId: checks.fluentcrmCompanyId, fluentcrmContactExists: checks.fluentcrmContactExists, fluentcrmContactId: checks.fluentcrmContactId, fluentcrmContactBelongsToCompany: checks.fluentcrmContactBelongsToCompany } });
    await recordStep({ operation, stepName: STEP_NAMES.PROVIDER_VERIFICATION_WORDPRESS, status: STEP_STATUSES.RUNNING, metadata: { entityType: "wordpress.user", targetIdentity: checks.email || checks.logtoUserId || organizationId, providerStatus: "wordpress_check_started", humanMessage: "Verificación live WordPress iniciada" } });
    const wpLookup = await findWordPressUserByEmail(checks.email);
    checks.wordpressConfigured = wpLookup.configured;
    checks.wordpressUserExists = wpLookup.status === "not_configured" ? null : Boolean(wpLookup.user);
    checks.wordpressUserId = wpLookup.user?.id || wpLookup.user?.ID || null;
    checks.wordpressUserEmailMatchesLogto = wpLookup.user ? normalizeEmailForVerification(wpLookup.user.email || wpLookup.user.user_email) === checks.email : null;
    const contactWpUserId = contact ? getContactWpUserId(contact) : null;
    checks.contactLinkedToWpUser = contact && checks.wordpressUserId ? String(contactWpUserId || "") === String(checks.wordpressUserId) : contact && !checks.wordpressUserId ? false : null;
    await recordStep({ operation, stepName: STEP_NAMES.PROVIDER_VERIFICATION_WORDPRESS, status: STEP_STATUSES.COMPLETED, metadata: { entityType: "wordpress.user", targetIdentity: checks.email || checks.logtoUserId || organizationId, providerStatus: "wordpress_check_completed", humanMessage: "Verificación live WordPress completada", wordpressUserExists: checks.wordpressUserExists, wordpressUserId: checks.wordpressUserId, wordpressUserEmailMatchesLogto: checks.wordpressUserEmailMatchesLogto, contactLinkedToWpUser: checks.contactLinkedToWpUser } });
    const conclusion = buildVerificationConclusion(checks);
    const result = { ...conclusion, ...checks, checks, level: "live_provider_verification", providerVerification: true };
    await recordStep({ operation, stepName: conclusion.status === "all_ok" || conclusion.status === "awaiting_first_wordpress_login" ? STEP_NAMES.PROVIDER_VERIFICATION_COMPLETED : STEP_NAMES.PROVIDER_VERIFICATION_PARTIAL_FAILED, status: conclusion.status === "all_ok" || conclusion.status === "awaiting_first_wordpress_login" ? STEP_STATUSES.COMPLETED : STEP_STATUSES.FAILED, retryable: conclusion.retryable, errorMessage: conclusion.status === "all_ok" ? null : conclusion.humanMessage, metadata: { entityType: "provider.verification", targetIdentity: organizationId, ...result } });
    await recordAuditLogBestEffort({ organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: conclusion.status === "all_ok" || conclusion.status === "awaiting_first_wordpress_login" ? AUDIT_RESULTS.SUCCESS : AUDIT_RESULTS.ERROR, metadata: { stage: "provider_verification.completed", ...result } });
    return { status: conclusion.status === "all_ok" || conclusion.status === "awaiting_first_wordpress_login" ? "completed" : "partial_failed", result, humanMessage: conclusion.humanMessage, retryable: conclusion.retryable };
  } catch (error) {
    const classification = classifyError(error);
    const timeout = classification.category === "timeout";
    const result = buildVerificationConclusion({ providerTimeout: timeout, providerAuthError: ["auth", "configuration"].includes(classification.category), providerAuthCode: error.code, providerAuthStatus: error.status });
    await recordStep({ operation, stepName: STEP_NAMES.PROVIDER_VERIFICATION_FAILED, status: STEP_STATUSES.FAILED, retryable: result.retryable, errorMessage: result.humanMessage, metadata: { entityType: "provider.verification", targetIdentity: organizationId, category: classification.category, providerCode: result.providerCode, providerStatus: result.providerStatus, humanMessage: result.humanMessage, nextAction: result.nextAction, availableActions: result.availableActions } });
    await recordAuditLogBestEffort({ organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.ERROR, metadata: { stage: "provider_verification.failed", category: classification.category, ...result } });
    return { status: "partial_failed", result, humanMessage: result.humanMessage, retryable: result.retryable };
  }
}

async function processMemberIdentityDownstreamSync(operation) {
  const organizationId = organizationIdFor(operation);
  const metadata = operationPayload(operation);
  const targetIdentity = metadata.logtoUserId || metadata.email || null;
  await recordStep({ operation, stepName: "fluentcrm_contacts.taken_by_worker", status: STEP_STATUSES.RUNNING, metadata: { entityType: "fluentcrm.contact", targetIdentity, providerStatus: "taken_by_worker", humanMessage: "Worker tomó retry de FluentCRM contact" } });
  await recordStep({ operation, stepName: "fluentcrm_contacts.processing_started", status: STEP_STATUSES.RUNNING, metadata: { entityType: "fluentcrm.contact", targetIdentity, providerStatus: "processing_contacts", humanMessage: "Procesamiento de contacto FluentCRM iniciado" } });
  await recordStep({ operation, stepName: STEP_NAMES.FLUENTCRM_CONTACT_UPSERT, status: STEP_STATUSES.RUNNING, metadata: { entityType: "fluentcrm.contact", targetIdentity, humanMessage: "Worker inició FluentCRM contact upsert" } });

  const profile = await getProfileForOperation(operation);
  const companyId = metadata.companyId || metadata.fluentcrmCompanyId || profile?.fluentcrmCompanyId || null;
  if (!companyId) {
    await recordStep({ operation, stepName: "contacts_not_started", status: STEP_STATUSES.SKIPPED, metadata: { entityType: "fluentcrm.contact", targetIdentity, reason: "missing_fluentcrm_company", providerCode: "FLUENTCRM_COMPANY_NOT_LINKED", providerStatus: "missing_fluentcrm_company", humanMessage: "Contactos no iniciados: falta Company enlazada en FluentCRM.", suggestedAction: "Reintentar sincronización de company" } });
    throw new FluentCrmError("Organization is not linked to a FluentCRM company", { code: "FLUENTCRM_COMPANY_NOT_LINKED", status: 409, body: { message: "company_not_linked" } });
  }

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
  const recovery = classifyMemberContactRecoveryState(result);
  const enrichedResult = { ...result, ...recovery, fluentcrmCompanyId: companyId };
  const completed = ["created", "updated"].includes(result.status);
  const status = completed ? "completed" : "partial_failed";
  const humanMessage = completed
    ? `FluentCRM contact ${result.status === "created" ? "creado" : "actualizado"} correctamente`
    : recovery.retryState === "manual_retry_required"
      ? "FluentCRM contact requiere retry manual"
      : recovery.retryState === "human_action_required"
        ? "FluentCRM contact requiere acción humana"
        : safeFunctionalMessage(result.message || result.reason, "FluentCRM contact sync requiere revisión");
  await recordStep({ operation, stepName: STEP_NAMES.FLUENTCRM_CONTACT_UPSERT, status: completed ? STEP_STATUSES.COMPLETED : STEP_STATUSES.FAILED, retryable: recovery.retryable, errorMessage: completed ? null : humanMessage, metadata: { result: enrichedResult, entityType: "fluentcrm.contact", targetIdentity, humanMessage, companyId, roleNames, retryState: recovery.retryState, requiresHumanAction: recovery.requiresHumanAction, suggestedAction: recovery.suggestedAction } });
  await recordStep({ operation, stepName: completed ? `fluentcrm_contacts.contact_${result.status}` : "fluentcrm_contacts.contact_failed", status: completed ? STEP_STATUSES.COMPLETED : STEP_STATUSES.FAILED, retryable: recovery.retryable, errorMessage: completed ? null : humanMessage, metadata: { index: 1, total: 1, logtoUserId: identity.logtoUserId, email: identity.email, fluentcrmCompanyId: companyId, fluentcrmContactId: result.contact?.id || result.contact?.ID || null, providerCode: enrichedResult.providerCode || enrichedResult.code || enrichedResult.reason || null, providerStatus: enrichedResult.providerStatus || enrichedResult.status, humanMessage, result: enrichedResult } });
  await recordStep({ operation, stepName: completed ? "fluentcrm_contacts.completed" : "fluentcrm_contacts.partial_failed", status: completed ? STEP_STATUSES.COMPLETED : STEP_STATUSES.FAILED, retryable: recovery.retryable, errorMessage: completed ? null : humanMessage, metadata: { attempted: 1, created: result.status === "created" ? 1 : 0, updated: result.status === "updated" ? 1 : 0, failed: completed ? 0 : 1, conflicts: result.status === "conflict" ? 1 : 0, providerStatus: completed ? "completed" : "partial_failed", humanMessage } });
  await recordAuditLogBestEffort({ organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_SYNC, result: completed ? AUDIT_RESULTS.SUCCESS : AUDIT_RESULTS.ERROR, metadata: { stage: completed ? "retry completed" : recovery.retryState, stepName: STEP_NAMES.FLUENTCRM_CONTACT_UPSERT, entityType: "fluentcrm.contact", targetIdentity, humanMessage, queueName: QUEUE_NAME, jobId: getSyncJobId(operation), result: enrichedResult } });
  return { status, result: enrichedResult, humanMessage, retryable: recovery.retryable, retryState: recovery.retryState, requiresHumanAction: recovery.requiresHumanAction };
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
    else if (operation.operationType === OPERATION_TYPES.PROVIDER_VERIFICATION) outcome = await processProviderVerification(operation);
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
    if (operation.operationType === OPERATION_TYPES.ORGANIZATION_PROFILE_DOWNSTREAM_SYNC) {
      await recordStep({ operation, stepName: "contacts_not_started", status: STEP_STATUSES.SKIPPED, metadata: { entityType: "fluentcrm.contact", targetIdentity: organizationIdFor(operation), reason: "company_sync_failed", contactsStatus: "not_started_due_to_company_failure", providerCode: error.code || null, providerStatus: error.status || classification.category, humanMessage: "Contactos no iniciados porque falló la sincronización de Company.", suggestedAction: "Reintentar sincronización de company" } });
    }
    await updateOperation(operation.id, { status, downstreamStatus: "failed", lastErrorJson: { message, retryable: classification.retryable, code: error.code || null, status: error.status || null }, resultSnapshotJson: { ...(operation.resultSnapshotJson || {}), errorCategory: classification.category } });
    await recordAuditLogBestEffort({ organizationId: organizationIdFor(operation), action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_ERROR, result: AUDIT_RESULTS.ERROR, metadata: { stage: "retry failed", stepName, entityType: stepName.includes("contact") ? "fluentcrm.contact" : "fluentcrm.company", targetIdentity: organizationIdFor(operation), humanMessage: `FluentCRM sync falló por ${classification.category}`, providerCode: error.code || null, providerStatus: error.status || null, queueName: QUEUE_NAME, jobId: getSyncJobId(operation), operationId: operation.id, category: classification.category, status } });
    return { status, retryable: classification.retryable, errorCategory: classification.category, message };
  }
}

module.exports = { OPERATION_TYPES, STEP_NAMES, classifyError, buildVerificationConclusion, processSyncOperation, processOrganizationProfileDownstreamSync, processProviderVerification, processMemberIdentityDownstreamSync, processMemberResetPassword };
