const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildWorkerQueuesObservabilityAggregate,
  classifyQueueState,
  classifyWorkerHealthState,
} = require("../services/operationalObservability");

test("worker/queue classifications expose alive, offline, stale, stuck, backlog and failed explicitly", () => {
  assert.equal(classifyWorkerHealthState({ worker: { heartbeatAt: "2026-06-28T00:00:00.000Z", heartbeatStale: false } }), "alive");
  assert.equal(classifyWorkerHealthState({ worker: { heartbeatStale: true, workerHeartbeatState: "worker_offline" } }), "worker_offline");
  assert.equal(classifyWorkerHealthState({ worker: { heartbeatAt: "2026-06-28T00:00:00.000Z", heartbeatStale: true } }), "worker_heartbeat_stale");
  assert.equal(classifyQueueState({ waiting: 1, oldestJobAgeSeconds: 100 }, { workerState: "worker_offline" }), "stuck_in_queue");
  assert.equal(classifyQueueState({ waiting: 11, oldestJobAgeSeconds: 100 }, { workerState: "alive" }), "backlog_growing");
  assert.equal(classifyQueueState({ failed: 1 }, { workerState: "alive" }), "failed_jobs_present");
});

test("worker queues aggregate reuses operational backbone shape for endpoint sections", () => {
  const generatedAt = new Date("2026-06-28T12:00:00.000Z");
  const aggregate = buildWorkerQueuesObservabilityAggregate({
    generatedAt,
    workerHealth: {
      readiness: "ready",
      worker: { heartbeatAt: "2026-06-28T11:59:55.000Z", heartbeatStale: false, workerHeartbeatState: "alive", source: "postgres.operational_metric_snapshots" },
      redis: { status: "ok", source: "redis_ping_and_bullmq_queue_stats" },
      queues: [{ name: "sync", waiting: 0, active: 1, delayed: 0, failed: 0, oldestJobAgeSeconds: 5 }],
    },
    operations: [{ id: "op1", operationType: "organization_profile_downstream_sync", entityType: "organization", entityId: "org1", logtoOrganizationId: "org1", status: "running", createdAt: "2026-06-28T11:59:00.000Z", updatedAt: "2026-06-28T11:59:30.000Z" }],
    steps: [{ id: "step1", operationId: "op1", stepName: "fluentcrm.company.ensure", queueName: "sync", jobId: "job1", status: "running", outputJson: { providerCode: "FC_COMPANY_SYNC", providerStatus: "running", humanMessage: "Company en progreso" }, createdAt: "2026-06-28T11:59:00.000Z", updatedAt: "2026-06-28T11:59:30.000Z" }],
    profiles: [{ id: "p1", logtoOrganizationId: "org1", nameCache: "Colegio Uno", fluentcrmCompanyId: null, fluentcrmSyncStatus: "not_linked", updatedAt: "2026-06-28T11:58:00.000Z" }],
    auditLogRows: [{ id: "audit1", organizationId: "org1", action: "retry_requested", result: "success", metadata: { operationId: "op1", humanMessage: "Retry solicitado" }, createdAt: "2026-06-28T11:59:40.000Z" }],
  });

  assert.equal(aggregate.workerHealth.classification, "alive");
  assert.equal(aggregate.workerHealth.freshness.source, "worker_runtime");
  assert.equal(aggregate.queues[0].classification, "alive");
  assert.equal(aggregate.activeOperations[0].operationId, "op1");
  assert.equal(aggregate.activeOperations[0].queueName, "sync");
  assert.equal(aggregate.activeOperations[0].jobId, "job1");
  assert.equal(aggregate.activeOperations[0].providerCode, "FC_COMPANY_SYNC");
  assert.equal(aggregate.activeOperations[0].freshness.source, "worker_runtime");
  assert.equal(aggregate.blockedOrganizations[0].logtoOrganizationId, "org1");
  assert.equal(aggregate.blockedOrganizations[0].blocker, "missing_company");
  assert.equal(aggregate.timeline[0].type, "retry_requested");
  assert.ok(aggregate.source.backbone.includes("operational/contract"));
});
