const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyError, OPERATION_TYPES, buildVerificationConclusion } = require("../services/syncOperationProcessors");

test("new operation types have explicit processors", () => {
  assert.equal(OPERATION_TYPES.ORGANIZATION_PROFILE_DOWNSTREAM_SYNC, "organization_profile_downstream_sync");
  assert.equal(OPERATION_TYPES.MEMBER_IDENTITY_DOWNSTREAM_SYNC, "member_identity_downstream_sync");
  assert.equal(OPERATION_TYPES.MEMBER_RESET_PASSWORD, "member_reset_password");
  assert.equal(OPERATION_TYPES.PROVIDER_VERIFICATION, "provider_verification");
});

test("classifyError separates retryable and non-retryable failures", () => {
  assert.deepEqual(classifyError({ code: "FLUENTCRM_TIMEOUT" }), { category: "timeout", retryable: true });
  assert.deepEqual(classifyError({ code: "FLUENTCRM_CONFIG_MISSING" }), { category: "configuration", retryable: false });
  assert.deepEqual(classifyError({ status: 401 }), { category: "auth", retryable: false });
  assert.deepEqual(classifyError({ status: 409 }), { category: "downstream_conflict", retryable: false });
  assert.deepEqual(classifyError({ code: "LOGTO_UNSUPPORTED_CAPABILITY" }), { category: "unsupported_capability", retryable: false });
});

function loadProcessorsWithMocks({ profile = { id: "profile-1", logtoOrganizationId: "org-1", fluentcrmCompanyId: "company-1" }, roles = [{ name: "Admin-org" }], upsertResult = { status: "created", contact: { id: 10 }, email: "ada@school.edu", logtoUserId: "user-1" } } = {}) {
  const processorPath = require.resolve("../services/syncOperationProcessors");
  const fluentPath = require.resolve("../services/fluentCrm");
  const logtoPath = require.resolve("../services/logtoManagement");
  const profilesPath = require.resolve("../services/organizationProfiles");
  const syncOpsPath = require.resolve("../services/syncOperations");
  const auditPath = require.resolve("../services/auditLogs");
  delete require.cache[processorPath];
  require.cache[fluentPath] = { exports: { FluentCrmError: class FluentCrmError extends Error { constructor(message, opts = {}) { super(message); this.name = "FluentCrmError"; Object.assign(this, opts); } }, getOrCreateCompanyForOrganization: async () => ({}), searchCompanies: async () => [], searchContacts: async () => [], upsertContactFromLogtoIdentity: async (args) => ({ ...upsertResult, args }) } };
  require.cache[logtoPath] = { exports: { getLogtoOrganizationById: async () => ({}), getLogtoUserById: async () => ({}), createLogtoUserPasswordResetRequest: async () => ({}), listLogtoOrganizationUserRoles: async () => roles, listLogtoOrganizationUsers: async () => [] } };
  require.cache[profilesPath] = { exports: { listOrganizationProfiles: async () => profile ? [profile] : [] } };
  const steps = [];
  const updates = [];
  require.cache[syncOpsPath] = { exports: { STEP_STATUSES: { RUNNING: "running", COMPLETED: "completed", FAILED: "failed", SKIPPED: "skipped" }, recordOperationStep: async (step) => { steps.push(step); return step; }, safeFunctionalMessage: (message, fallback = "Sync failed") => message || fallback, updateSyncOperation: async (patch) => { updates.push(patch); return patch; } } };
  require.cache[auditPath] = { exports: { AUDIT_ACTIONS: { OWNER_ORGANIZATION_FLUENTCRM_SYNC: "owner.organization.fluentcrm_sync", OWNER_ORGANIZATION_PROVISIONING: "owner.organization.provisioning", OWNER_ORGANIZATION_FLUENTCRM_ERROR: "owner.organization.fluentcrm_error" }, AUDIT_RESULTS: { SUCCESS: "success", ERROR: "error" }, recordAuditLogBestEffort: async () => null } };
  const processors = require("../services/syncOperationProcessors");
  return { processors, steps, updates };
}

test("processMemberIdentityDownstreamSync creates a missing FluentCRM contact through upsert", async () => {
  const { processors, steps } = loadProcessorsWithMocks({ upsertResult: { status: "created", contact: { id: 10 }, email: "ada@school.edu", logtoUserId: "user-1" } });
  const outcome = await processors.processMemberIdentityDownstreamSync({ id: "op-1", operationType: OPERATION_TYPES.MEMBER_IDENTITY_DOWNSTREAM_SYNC, logtoOrganizationId: "org-1", payloadSnapshotJson: { logtoUserId: "user-1", email: "ada@school.edu", firstName: "Ada", lastName: "Lovelace" } });
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.result.status, "created");
  assert.equal(outcome.result.args.companyId, "company-1");
  assert.deepEqual(outcome.result.args.roleNames, ["Admin-org"]);
  assert.equal(steps.at(-1).status, "completed");
});

test("processMemberIdentityDownstreamSync updates an existing FluentCRM contact through upsert", async () => {
  const { processors } = loadProcessorsWithMocks({ upsertResult: { status: "updated", contact: { id: 11 }, email: "grace@school.edu", logtoUserId: "user-2" } });
  const outcome = await processors.processMemberIdentityDownstreamSync({ id: "op-2", operationType: OPERATION_TYPES.MEMBER_IDENTITY_DOWNSTREAM_SYNC, logtoOrganizationId: "org-1", payloadSnapshotJson: { logtoUserId: "user-2", email: "grace@school.edu", previousEmail: "old@school.edu", roleNames: ["Teacher-org"] } });
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.result.status, "updated");
  assert.deepEqual(outcome.result.args.roleNames, ["Teacher-org"]);
});

test("processMemberIdentityDownstreamSync reports partial failure when company is not linked", async () => {
  const { processors } = loadProcessorsWithMocks({ profile: { id: "profile-1", logtoOrganizationId: "org-1", fluentcrmCompanyId: null } });
  const outcome = await processors.processSyncOperation({ id: "op-3", operationType: OPERATION_TYPES.MEMBER_IDENTITY_DOWNSTREAM_SYNC, logtoOrganizationId: "org-1", payloadSnapshotJson: { logtoUserId: "user-3", email: "missing@school.edu" } });
  assert.equal(outcome.status, "partial_failed");
  assert.equal(outcome.errorCategory, "downstream_conflict");
});

test("processMemberIdentityDownstreamSync preserves conflict state from FluentCRM duplicate contacts", async () => {
  const { processors } = loadProcessorsWithMocks({ upsertResult: { status: "conflict", reason: "duplicate_contact", candidateCount: 2, email: "dup@school.edu", logtoUserId: "user-dup" } });
  const outcome = await processors.processMemberIdentityDownstreamSync({ id: "op-4", operationType: OPERATION_TYPES.MEMBER_IDENTITY_DOWNSTREAM_SYNC, logtoOrganizationId: "org-1", payloadSnapshotJson: { logtoUserId: "user-dup", email: "dup@school.edu" } });
  assert.equal(outcome.status, "partial_failed");
  assert.equal(outcome.result.reason, "duplicate_contact");
});

test("runFluentCrmOrganizationStep triggers member contact sync after ensuring Company", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../index.js"), "utf8");
  const functionStart = source.indexOf("async function runFluentCrmOrganizationStep");
  const companyEnsure = source.indexOf("getOrCreateCompanyForOrganization", functionStart);
  const memberLoad = source.indexOf("listLogtoOrganizationUsers({ organizationId: logtoOrganizationId })", functionStart);
  const scheduledSync = source.indexOf("runOrganizationContactSyncAfterCompany", functionStart);
  const helperStart = source.indexOf("async function runOrganizationContactSyncAfterCompany");
  const helperContactSync = source.indexOf("syncOrganizationContactsToFluentCrm", helperStart);
  const adminVisibility = source.indexOf("covered_by_post_company_member_sync", functionStart);
  assert.ok(functionStart >= 0);
  assert.ok(companyEnsure > functionStart);
  assert.ok(scheduledSync > companyEnsure);
  assert.ok(helperStart > functionStart);
  assert.ok(memberLoad > helperStart);
  assert.ok(helperContactSync > memberLoad);
  assert.ok(adminVisibility > scheduledSync);
});


test("worker registers a real consumer for queued sync operations", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../worker.js"), "utf8");
  assert.match(source, /new Worker\(SYNC_QUEUE_NAME/);
  assert.match(source, /processSyncOperation\(job\.data\?\.operationId\)/);
});


test("operational projections use synchronous worker health snapshot without Promise catch", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../services/syncOperations.js"), "utf8");
  assert.doesNotMatch(source, /getWorkerHealthSnapshot\(\)\.catch/);
  assert.match(source, /getWorkerHealthSnapshot\(\)/);
});


test("bootstrap downstream records company diagnostics and contacts_not_started when Company blocks contacts", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../services/organizationBootstrapOrchestrator.js"), "utf8");
  assert.match(source, /buildCompanyFailureDiagnostics/);
  assert.match(source, /providerCode/);
  assert.match(source, /contacts_not_started/);
  assert.match(source, /not_started_due_to_company_failure/);
  assert.match(source, /Contactos no iniciados/);
});

test("pending projection preserves provider code from step error diagnostics", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../services/syncOperations.js"), "utf8");
  assert.match(source, /visibleStep\?\.lastErrorJson\?\.code/);
  assert.match(source, /No se pudo crear o enlazar la Company en FluentCRM/);
  assert.match(source, /La solicitud a FluentCRM expiró por timeout/);
});

test("provider verification conclusion returns all_ok when live checks are consistent", () => {
  const conclusion = buildVerificationConclusion({
    logtoOrganizationExists: true,
    logtoMembershipValid: true,
    fluentcrmCompanyExists: true,
    fluentcrmContactExists: true,
    wordpressUserExists: true,
    contactLinkedToWpUser: true,
  });
  assert.equal(conclusion.status, "all_ok");
  assert.equal(conclusion.providerCode, "ALL_OK");
  assert.equal(conclusion.nextAction, "open_organization");
});

test("provider verification distinguishes missing FluentCRM Company as downstream retry", () => {
  const conclusion = buildVerificationConclusion({
    logtoOrganizationExists: true,
    logtoMembershipValid: true,
    fluentcrmCompanyExists: false,
  });
  assert.equal(conclusion.status, "missing_fluentcrm_company");
  assert.equal(conclusion.providerStatus, "missing_fluentcrm_company");
  assert.equal(conclusion.nextAction, "retry_company");
  assert.equal(conclusion.retryable, true);
  assert.ok(conclusion.availableActions.includes("retry_company"));
});

test("provider verification distinguishes missing FluentCRM Contact from Logto membership problems", () => {
  const conclusion = buildVerificationConclusion({
    logtoOrganizationExists: true,
    logtoMembershipValid: true,
    fluentcrmCompanyExists: true,
    fluentcrmContactExists: false,
  });
  assert.equal(conclusion.status, "missing_fluentcrm_contact");
  assert.equal(conclusion.nextAction, "retry_contacts");
  assert.match(conclusion.humanMessage, /Falta contacto en FluentCRM/);
});

test("provider verification treats a contact outside the linked Company as downstream contact inconsistency", () => {
  const conclusion = buildVerificationConclusion({
    logtoOrganizationExists: true,
    logtoMembershipValid: true,
    fluentcrmCompanyExists: true,
    fluentcrmContactExists: true,
    fluentcrmContactBelongsToCompany: false,
  });
  assert.equal(conclusion.status, "missing_fluentcrm_contact");
  assert.equal(conclusion.nextAction, "retry_contacts");
});

test("provider verification treats missing WordPress user as first-login state", () => {
  const conclusion = buildVerificationConclusion({
    logtoOrganizationExists: true,
    logtoMembershipValid: true,
    fluentcrmCompanyExists: true,
    fluentcrmContactExists: true,
    wordpressUserExists: false,
  });
  assert.equal(conclusion.status, "awaiting_first_wordpress_login");
  assert.equal(conclusion.nextAction, "open_organization");
  assert.equal(conclusion.retryable, false);
});

test("provider verification flags missing CRM contact to WordPress user link", () => {
  const conclusion = buildVerificationConclusion({
    logtoOrganizationExists: true,
    logtoMembershipValid: true,
    fluentcrmCompanyExists: true,
    fluentcrmContactExists: true,
    wordpressUserExists: true,
    contactLinkedToWpUser: false,
  });
  assert.equal(conclusion.status, "missing_contact_wp_link");
  assert.equal(conclusion.nextAction, "verify_provider");
});

test("provider verification maps provider technical errors to actionable statuses", () => {
  const timeout = buildVerificationConclusion({ providerTimeout: true });
  assert.equal(timeout.status, "provider_timeout");
  assert.equal(timeout.nextAction, "retry");
  assert.equal(timeout.retryable, true);

  const auth = buildVerificationConclusion({ providerAuthError: true, providerAuthCode: "WORDPRESS_AUTHORIZATION_FAILED", providerAuthStatus: 403 });
  assert.equal(auth.status, "provider_auth_error");
  assert.equal(auth.providerCode, "WORDPRESS_AUTHORIZATION_FAILED");
  assert.equal(auth.nextAction, "open_settings");

  const network = buildVerificationConclusion({ networkError: true, providerCode: "FLUENTCRM_REQUEST_FAILED", providerStatus: "network_error" });
  assert.equal(network.status, "provider_network_error");
  assert.equal(network.providerCode, "FLUENTCRM_REQUEST_FAILED");
  assert.equal(network.nextAction, "retry");

  const validation = buildVerificationConclusion({ validationError: true, providerCode: "FLUENTCRM_VALIDATION_FAILED", providerStatus: 422 });
  assert.equal(validation.status, "provider_validation_error");
  assert.equal(validation.providerCode, "FLUENTCRM_VALIDATION_FAILED");
  assert.equal(validation.nextAction, "open_organization");
});

test("provider verification is queued as a live worker operation instead of local-only projection", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../services/syncOperations.js"), "utf8");
  assert.match(source, /operationType: "provider_verification"/);
  assert.match(source, /enqueueSyncOperation\(created\)/);
  assert.match(source, /queued_for_live_check/);
  assert.match(source, /live_requested_not_local_projection/);
});

test("provider verification processor performs live Logto, FluentCRM and WordPress checks", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../services/syncOperationProcessors.js"), "utf8");
  assert.match(source, /async function processProviderVerification/);
  assert.match(source, /getLogtoOrganizationById/);
  assert.match(source, /listLogtoOrganizationUsers/);
  assert.match(source, /searchCompanies/);
  assert.match(source, /searchContacts/);
  assert.match(source, /findWordPressUserByEmail/);
  assert.match(source, /provider_verification\.taken_by_worker/);
  assert.match(source, /provider_verification\.logto_check_started/);
  assert.match(source, /provider_verification\.fluentcrm_check_started/);
  assert.match(source, /provider_verification\.wordpress_check_started/);
  assert.match(source, /source: "live_provider_verification"/);
});

test("worker registers DB polling fallback and heartbeat for queued sync operations", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../worker.js"), "utf8");
  assert.match(source, /processQueuedSyncOperationsBatch/);
  assert.match(source, /startSyncOperationDbPoller/);
  assert.match(source, /recordWorkerHeartbeat/);
  assert.match(source, /SYNC_OPERATION_DB_POLL_INTERVAL_MS/);
});
