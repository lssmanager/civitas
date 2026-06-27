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

test("orchestration exposes reusable operation statuses and bootstrap steps", () => {
  assert.equal(OPERATION_STATUSES.QUEUED, "queued");
  assert.equal(OPERATION_STATUSES.RUNNING, "running");
  assert.equal(OPERATION_STATUSES.CANONICAL_COMPLETED, "canonical_completed");
  assert.equal(OPERATION_STATUSES.PARTIAL_FAILED, "partial_failed");
  assert.equal(PHASE_STATUSES.PENDING, "pending");
  assert.equal(STEP_STATUSES.COMPLETED, "completed");
  assert.equal(QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, "organization.bootstrap");
  assert.equal(QUEUE_NAMES.SYNC_OPERATIONS, "civitas-sync-operations");
  assert.equal(STEP_NAMES.LOGTO_CANONICAL_BOOTSTRAP, "logto_canonical_bootstrap");
  assert.equal(STEP_NAMES.FLUENTCRM_COMPANY, "fluentcrm_company");
  assert.equal(STEP_NAMES.FINALIZE, "finalize");
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

test("configuration and conflict errors are non-retryable", () => {
  const config = classifyOperationalError({ message: "FluentCRM is not configured", code: "FLUENTCRM_CONFIG_MISSING" });
  assert.equal(config.retryable, false);
  assert.equal(config.category, "configuration_or_contract_error");

  const conflict = classifyOperationalError({ message: "Duplicate contact", code: "FLUENTCRM_DUPLICATE_CONTACT" });
  assert.equal(conflict.retryable, false);
});

test("Logto 422 is classified as non-retryable canonical validation failure", () => {
  const classified = classifyOperationalError({ message: "Logto Management API request failed", status: 422, code: "LOGTO_MANAGEMENT_VALIDATION", request: { method: "POST", path: "/users" } });
  assert.equal(classified.system, "logto");
  assert.equal(classified.category, "validation_error");
  assert.equal(classified.retryable, false);
  assert.equal(classified.request.path, "/users");
});
