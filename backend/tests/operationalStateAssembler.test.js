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

test("live verification uses completed provider verification events when no pending check exists", () => {
  const live = buildLiveVerificationOperationalBlock({
    profile: baseProfile,
    pending: [],
    events: [{
      id: "op-op-live-event",
      at: "2026-06-27T00:04:00.000Z",
      stage: "provider_verification.finished",
      result: "completed",
      retryOperationId: "op-live-event",
      providerCode: "ALL_OK",
      humanMessage: "Verificación live completada",
    }],
  });

  assert.equal(live.freshness.source, "live_provider_check");
  assert.equal(live.status, "all_ok");
  assert.equal(live.severity, "success");
  assert.equal(live.details.pending, null);
  assert.equal(live.details.event.id, "op-op-live-event");
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

test("canonical block distinguishes unavailable Logto fetch from missing organization", () => {
  const unavailable = buildConsolidatedOperationalResponse({
    organization: { logtoOrganizationId: "org_1", name: "Org One", sourceAnchors: { logtoOrganizationId: "org_1" } },
    logtoOrganization: { __operationalFetchState: "unavailable", source: "logto", status: 503, message: "timeout" },
    profile: baseProfile,
    generatedAt: "2026-06-27T00:01:30.000Z",
  });
  assert.equal(unavailable.canonical.status, "unavailable");
  assert.equal(unavailable.canonical.severity, "warning");
  assert.equal(unavailable.canonical.providerCode, "LOGTO_ORGANIZATION_UNAVAILABLE");

  const missing = buildConsolidatedOperationalResponse({
    organization: { logtoOrganizationId: "org_1", name: "Org One", sourceAnchors: { logtoOrganizationId: "org_1" } },
    logtoOrganization: null,
    profile: baseProfile,
    generatedAt: "2026-06-27T00:01:30.000Z",
  });
  assert.equal(missing.canonical.status, "missing");
  assert.equal(missing.canonical.severity, "critical");
  assert.equal(missing.canonical.providerCode, "LOGTO_ORGANIZATION_MISSING");
});

test("latestEventIds are populated only from event ids", () => {
  const response = buildConsolidatedOperationalResponse({
    organization: { logtoOrganizationId: "org_1", name: "Org One", sourceAnchors: { logtoOrganizationId: "org_1" } },
    logtoOrganization: { id: "org_1", name: "Org One" },
    profile: baseProfile,
    pending: [
      { operationId: "operation-company", entityType: "fluentcrm.company", status: "queued", retryState: "queued" },
      { operationId: "operation-contact", entityType: "fluentcrm.contact", status: "queued", retryState: "queued" },
    ],
    events: [
      { id: "audit-1", rowType: "administrative_event", createdAt: "2026-06-27T00:01:00.000Z" },
      { id: "op-provider-event", stage: "provider_verification.finished", result: "completed", retryOperationId: "operation-provider", createdAt: "2026-06-27T00:02:00.000Z" },
      { id: "op-company-event", entityType: "fluentcrm.company", operationType: "organization_profile_downstream_sync", createdAt: "2026-06-27T00:03:00.000Z" },
      { id: "op-contact-event", entityType: "fluentcrm.contact", metadata: { contacts: [{ email: "c@example.test" }] }, createdAt: "2026-06-27T00:04:00.000Z" },
    ],
  });
  assert.deepEqual(response.latestEventIds, {
    audit: "audit-1",
    providerVerification: "op-provider-event",
    fluentcrmCompany: "op-company-event",
    fluentcrmContacts: "op-contact-event",
  });
});

test("contact progress fallback is decided per item", () => {
  const items = buildContactProgressFromPendingAndEvents({
    profile: baseProfile,
    pending: [
      { operationId: "op-with-metadata", entityType: "fluentcrm.contact", metadata: { contacts: [{ email: "first@example.test" }] }, createdAt: "2026-06-27T00:02:00.000Z" },
      { operationId: "op-without-metadata", entityType: "fluentcrm.contact", email: "second@example.test", humanMessage: "Fallback row", createdAt: "2026-06-27T00:03:00.000Z" },
    ],
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].email, "first@example.test");
  assert.equal(items[1].email, "second@example.test");
});
