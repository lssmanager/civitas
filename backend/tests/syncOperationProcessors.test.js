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
