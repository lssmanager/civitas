const assert = require("node:assert/strict");
const test = require("node:test");

const { QUEUE_NAMES, getBullMqPrefix, getRedisUrl } = require("../queues/config");
const { OPERATION_STATUSES, PHASE_STATUSES, STEP_STATUSES, classifyOperationalError } = require("../services/syncOperations");
const { STEP_NAMES } = require("../services/organizationBootstrapOrchestrator");

test("REDIS_URL is read from a single URL env var", () => {
  const previous = process.env.REDIS_URL;
  process.env.REDIS_URL = "redis://redis:6379";
  assert.equal(getRedisUrl(), "redis://redis:6379");
  assert.equal(getBullMqPrefix(), process.env.BULLMQ_PREFIX || "civitas");
  process.env.REDIS_URL = previous;
});

test("missing REDIS_URL fails with a clear worker/API configuration error", () => {
  const previous = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  assert.throws(() => getRedisUrl(), /REDIS_URL is required/);
  if (previous) process.env.REDIS_URL = previous;
});

test("orchestration exposes canonical/downstream statuses and bootstrap step names", () => {
  assert.equal(OPERATION_STATUSES.CANONICAL_COMPLETED, "canonical_completed");
  assert.equal(OPERATION_STATUSES.PARTIAL_FAILED, "partial_failed");
  assert.equal(PHASE_STATUSES.COMPLETED, "completed");
  assert.equal(STEP_STATUSES.FAILED, "failed");
  assert.equal(QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, "organization.bootstrap");
  assert.deepEqual(Object.values(STEP_NAMES), [
    "validate_input",
    "logto_canonical_bootstrap",
    "reconcile_organization_profile",
    "prepare_crm_payload",
    "fluentcrm_company",
    "fluentcrm_contacts",
    "finalize",
  ]);
});

test("FluentCRM 422 is classified as non-retryable downstream validation failure", () => {
  const classified = classifyOperationalError({ message: "FluentCRM rejected payload", status: 422, code: "FLUENTCRM_VALIDATION_FAILED" });
  assert.equal(classified.system, "fluentcrm");
  assert.equal(classified.category, "validation_error");
  assert.equal(classified.retryable, false);
});

test("Logto timeout remains retryable and canonical-scoped", () => {
  const classified = classifyOperationalError({ message: "Logto timeout", code: "LOGTO_TIMEOUT" });
  assert.equal(classified.system, "logto");
  assert.equal(classified.retryable, true);
});
