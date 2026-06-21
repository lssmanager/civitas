const test = require("node:test");
const assert = require("node:assert/strict");
const { buildOperationsSummary, classifyTechnicalHealth } = require("../services/operationalObservability");

test("classifyTechnicalHealth returns healthy functional status without stale worker or backlog", () => {
  const health = classifyTechnicalHealth({ worker: { heartbeatStale: false }, redis: { status: "ok" }, queues: [{ waiting: 0, failed: 0, oldestJobAgeSeconds: 0 }] });
  assert.equal(health.status, "healthy");
  assert.match(health.message, /al día/i);
});

test("classifyTechnicalHealth translates stale worker with backlog to stopped synchronization", () => {
  const health = classifyTechnicalHealth({ worker: { heartbeatStale: true }, redis: { status: "ok" }, queues: [{ waiting: 3 }] });
  assert.equal(health.status, "stalled");
  assert.equal(health.code, "worker_stale_with_backlog");
  assert.match(health.message, /detenida/i);
});

test("classifyTechnicalHealth translates growing backlog without raw queue language", () => {
  const health = classifyTechnicalHealth({ worker: { heartbeatStale: false }, redis: { status: "ok" }, queues: [{ waiting: 12, oldestJobAgeSeconds: 1000 }] });
  assert.equal(health.status, "degraded");
  assert.equal(health.code, "backlog_growing");
  assert.doesNotMatch(health.message, /queue depth|oldest job/i);
});

test("buildOperationsSummary exposes partial failures and pending downstream organizations", () => {
  const summary = buildOperationsSummary({
    operations: [{ status: "queued" }, { status: "running" }, { status: "partial_failed", retryable: true }],
    profiles: [{ id: "p1", logtoOrganizationId: "org1", nameCache: "Colegio Uno", logtoSyncStatus: "bootstrapped", fluentcrmSyncStatus: "error", fluentcrmSyncError: "FluentCRM rechazó la compañía" }],
    technicalHealth: { worker: { heartbeatStale: false }, redis: { status: "ok" }, queues: [] },
  });
  assert.equal(summary.counts.queued, 1);
  assert.equal(summary.counts.running, 1);
  assert.equal(summary.counts.partialFailed, 1);
  assert.equal(summary.counts.retryable, 1);
  assert.equal(summary.counts.organizationsWithPendingDownstreamSync, 1);
  assert.equal(summary.organizations[0].bootstrapStatus, "running");
  assert.equal(summary.organizations[0].retryable, true);
  assert.match(summary.incidents[0].message, /FluentCRM/);
});

test("buildOperationsSummary returns no incidents when there are no functional failures", () => {
  const summary = buildOperationsSummary({
    operations: [],
    profiles: [{ id: "p1", logtoOrganizationId: "org1", nameCache: "Colegio Uno", logtoSyncStatus: "bootstrapped", fluentcrmSyncStatus: "linked" }],
    technicalHealth: { worker: { heartbeatStale: false }, redis: { status: "ok" }, queues: [] },
  });
  assert.deepEqual(summary.incidents, []);
  assert.equal(summary.counts.organizationsWithPendingDownstreamSync, 0);
  assert.equal(summary.functionalHealth.status, "healthy");
});
