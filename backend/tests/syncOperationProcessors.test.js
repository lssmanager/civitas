const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyError, OPERATION_TYPES } = require("../services/syncOperationProcessors");

test("new operation types have explicit processors", () => {
  assert.equal(OPERATION_TYPES.ORGANIZATION_PROFILE_DOWNSTREAM_SYNC, "organization_profile_downstream_sync");
  assert.equal(OPERATION_TYPES.MEMBER_IDENTITY_DOWNSTREAM_SYNC, "member_identity_downstream_sync");
  assert.equal(OPERATION_TYPES.MEMBER_RESET_PASSWORD, "member_reset_password");
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
  require.cache[fluentPath] = { exports: { FluentCrmError: class FluentCrmError extends Error { constructor(message, opts = {}) { super(message); this.name = "FluentCrmError"; Object.assign(this, opts); } }, getOrCreateCompanyForOrganization: async () => ({}), upsertContactFromLogtoIdentity: async (args) => ({ ...upsertResult, args }) } };
  require.cache[logtoPath] = { exports: { getLogtoOrganizationById: async () => ({}), createLogtoUserPasswordResetRequest: async () => ({}), listLogtoOrganizationUserRoles: async () => roles } };
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
  const contactSync = source.indexOf("syncOrganizationContactsToFluentCrm", functionStart);
  const adminVisibility = source.indexOf("assignment_not_found_in_logto_members", functionStart);
  assert.ok(functionStart >= 0);
  assert.ok(companyEnsure > functionStart);
  assert.ok(memberLoad > companyEnsure);
  assert.ok(contactSync > memberLoad);
  assert.ok(adminVisibility > contactSync);
});
