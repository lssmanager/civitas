const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildConsolidatedOperationalResponse,
  buildContactProgressFromPendingAndEvents,
  buildFreshness,
  buildLiveVerificationOperationalBlock,
  buildPollingPolicy,
} = require("../services/operationalStateAssembler");

const baseProfile = {
  id: "profile-1",
  logtoOrganizationId: "org_1",
  nameCache: "Org One",
  fluentcrmCompanyId: "company-1",
  fluentcrmSyncStatus: "linked",
  updatedAt: "2026-06-27T00:00:00.000Z",
};

test("assembler freshness keeps persisted snapshots stale and live checks auto-refreshable", () => {
  const snapshot = buildFreshness({ source: "persisted_snapshot", checkedAt: "2026-06-27T00:00:00.000Z", now: "2026-06-27T00:00:01.000Z" });
  assert.equal(snapshot.isStale, true);
  assert.equal(snapshot.shouldAutoRefresh, false);

  const live = buildFreshness({ source: "live_provider_check", checkedAt: "2026-06-27T00:00:00.000Z", now: "2026-06-27T00:03:00.000Z", staleAfterSeconds: 120 });
  assert.equal(live.isStale, true);
  assert.equal(live.shouldAutoRefresh, true);
});

test("live verification distinguishes live provider checks from snapshot fallback", () => {
  const fallback = buildLiveVerificationOperationalBlock({ profile: baseProfile, pending: [] });
  assert.equal(fallback.freshness.source, "persisted_snapshot");
  assert.equal(fallback.status, "not_checked");
  assert.match(fallback.humanMessage, /No existe verificación live reciente/);

  const live = buildLiveVerificationOperationalBlock({
    profile: baseProfile,
    pending: [{ operationId: "op-live", operationType: "provider_verification", status: "completed", providerStatus: "all_ok", updatedAt: "2026-06-27T00:01:00.000Z" }],
  });
  assert.equal(live.freshness.source, "live_provider_check");
  assert.equal(live.status, "all_ok");
  assert.equal(live.severity, "success");
});

test("polling policy uses 3 seconds for active worker runtime and stops when stable", () => {
  assert.deepEqual(buildPollingPolicy({ worker: { details: { queueState: "running", activeOperationIds: ["op-1"] } } }), {
    shouldPoll: true,
    intervalSeconds: 3,
    reason: "active_worker_runtime",
    activeOperationIds: ["op-1"],
  });
  assert.equal(buildPollingPolicy({ worker: { details: { queueState: "completed", activeOperationIds: [] } } }).shouldPoll, false);
});

test("contactProgress is derived from existing operational metadata and events", () => {
  const items = buildContactProgressFromPendingAndEvents({
    profile: baseProfile,
    pending: [{
      operationId: "op-contact",
      entityType: "fluentcrm.contact",
      stepName: "fluentcrm.contact.upsert",
      metadata: { contactProgress: [{ index: 1, total: 2, logtoUserId: "user-1", email: "a@example.test", fluentcrmContactId: "contact-1", action: "upsert", result: "completed", providerCode: "OK", humanMessage: "Contacto sincronizado", createdAt: "2026-06-27T00:02:00.000Z" }] },
      createdAt: "2026-06-27T00:02:00.000Z",
    }],
    events: [{ id: "event-1", metadata: { contacts: [{ email: "b@example.test", result: "failed", providerCode: "FLUENTCRM_DUPLICATE_CONTACT" }] }, createdAt: "2026-06-27T00:03:00.000Z" }],
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].logtoUserId, "user-1");
  assert.equal(items[1].email, "b@example.test");
});

test("consolidated response exposes phase-2 blocks and worker dominance for active queues", () => {
  const response = buildConsolidatedOperationalResponse({
    organization: { logtoOrganizationId: "org_1", name: "Org One", sourceAnchors: { logtoOrganizationId: "org_1" } },
    logtoOrganization: { id: "org_1", name: "Org One" },
    profile: baseProfile,
    pending: [{ operationId: "op-1", id: "op-1", operationType: "organization_profile_downstream_sync", entityType: "fluentcrm.company", status: "queued", retryState: "queued", updatedAt: "2026-06-27T00:01:00.000Z" }],
    events: [{ id: "audit-1", createdAt: "2026-06-27T00:01:00.000Z" }],
    workerHealth: { readiness: "ready", worker: { heartbeatAt: "2026-06-27T00:01:00.000Z", workerHeartbeatState: "alive" }, redis: { status: "ok" }, queues: [] },
    generatedAt: "2026-06-27T00:01:30.000Z",
  });

  for (const key of ["canonical", "fluentcrm", "wordpress", "worker", "liveVerification", "summary", "contactProgress", "polling"]) assert.ok(Object.hasOwn(response, key));
  assert.equal(response.worker.freshness.source, "worker_runtime");
  assert.equal(response.polling.intervalSeconds, 3);
  assert.equal(response.latestEventIds.audit, "audit-1");
});
