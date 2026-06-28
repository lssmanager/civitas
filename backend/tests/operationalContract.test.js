const test = require('node:test');
const assert = require('node:assert/strict');
const { buildConsolidatedOperationalResponse, buildFreshness, buildInvalidation, buildOperationalBlock, buildSummary, chooseDominantBlock, FRESHNESS_SOURCES } = require('../services/operational/contract');

test('freshness marks old live provider checks stale and auto-refreshable', () => {
  const freshness = buildFreshness({ source: FRESHNESS_SOURCES.LIVE_PROVIDER_CHECK, checkedAt: '2026-06-27T00:00:00.000Z', now: '2026-06-27T00:03:00.000Z', staleAfterSeconds: 120 });
  assert.equal(freshness.isStale, true);
  assert.equal(freshness.shouldAutoRefresh, true);
});

test('dominance prefers active worker runtime over live provider check', () => {
  const inv = buildInvalidation();
  const live = buildOperationalBlock({ status: 'all_ok', severity: 'success', freshness: buildFreshness({ source: FRESHNESS_SOURCES.LIVE_PROVIDER_CHECK }), invalidation: inv });
  const worker = buildOperationalBlock({ status: 'running', severity: 'warning', freshness: buildFreshness({ source: FRESHNESS_SOURCES.WORKER_RUNTIME }), invalidation: inv, runtime: { isActive: true } });
  assert.equal(chooseDominantBlock([live, worker]), worker);
});

test('consolidated response exposes required phase-1 blocks', () => {
  const block = buildOperationalBlock({ status: 'ok', severity: 'success', freshness: buildFreshness(), invalidation: buildInvalidation() });
  const response = buildConsolidatedOperationalResponse({ organization: { logtoOrganizationId: 'org', name: 'Org', sourceAnchors: { logtoOrganizationId: 'org' } }, canonical: block, fluentcrm: block, wordpress: block, worker: block, liveVerification: block, contactProgress: block });
  for (const key of ['organization','summary','canonical','fluentcrm','wordpress','worker','liveVerification','contactProgress','polling','latestEventIds']) assert.ok(Object.hasOwn(response, key));
});

test('summary dominantSource follows source dominance instead of worst severity', () => {
  const inv = buildInvalidation();
  const criticalSnapshot = buildOperationalBlock({ status: 'missing', severity: 'critical', freshness: buildFreshness({ source: FRESHNESS_SOURCES.PERSISTED_SNAPSHOT }), invalidation: inv });
  const worker = buildOperationalBlock({ status: 'running', severity: 'warning', freshness: buildFreshness({ source: FRESHNESS_SOURCES.WORKER_RUNTIME }), invalidation: inv, runtime: { isActive: true } });
  const summary = buildSummary({ criticalSnapshot, worker });
  assert.equal(summary.severity, 'critical');
  assert.equal(summary.dominantSource, FRESHNESS_SOURCES.WORKER_RUNTIME);
});

test('summary dominantSource prefers live provider check over local reconciled without active worker', () => {
  const inv = buildInvalidation();
  const local = buildOperationalBlock({ status: 'degraded', severity: 'warning', freshness: buildFreshness({ source: FRESHNESS_SOURCES.LOCAL_RECONCILED }), invalidation: inv });
  const live = buildOperationalBlock({ status: 'all_ok', severity: 'success', freshness: buildFreshness({ source: FRESHNESS_SOURCES.LIVE_PROVIDER_CHECK }), invalidation: inv });
  const summary = buildSummary({ local, live });
  assert.equal(summary.severity, 'warning');
  assert.equal(summary.dominantSource, FRESHNESS_SOURCES.LIVE_PROVIDER_CHECK);
});

test('phase 7 action catalog is canonical, documented and additive-safe', () => {
  const { OPERATIONAL_ACTIONS, OPERATIONAL_ACTION_DEFINITIONS, OPERATIONAL_ACTION_CATALOG_VERSION } = require('../services/operational/contract');
  assert.equal(OPERATIONAL_ACTION_CATALOG_VERSION, '2026-06-issue-181-action-catalog-v1');
  assert.deepEqual(OPERATIONAL_ACTIONS, ['retry', 'verify_provider', 'open_organization', 'wait_first_wordpress_login', 'manual_retry_required', 'human_action_required', 'none']);
  for (const action of OPERATIONAL_ACTIONS) {
    assert.equal(OPERATIONAL_ACTION_DEFINITIONS[action].action, action);
    assert.ok(OPERATIONAL_ACTION_DEFINITIONS[action].semantics);
    assert.ok(OPERATIONAL_ACTION_DEFINITIONS[action].backend);
    assert.ok(OPERATIONAL_ACTION_DEFINITIONS[action].frontend);
  }
});

test('phase 7 response exposes contract metadata and keeps unknown actions additive', () => {
  const { CONTRACT_VERSION, OPERATIONAL_ACTION_CATALOG_VERSION } = require('../services/operational/contract');
  const block = buildOperationalBlock({ status: 'ok', severity: 'success', availableActions: ['future_tool_action'], nextAction: 'future_tool_action', freshness: buildFreshness(), invalidation: buildInvalidation() });
  const response = buildConsolidatedOperationalResponse({ organization: { logtoOrganizationId: 'org', name: 'Org', sourceAnchors: { logtoOrganizationId: 'org' } }, canonical: block, fluentcrm: block, wordpress: block, worker: block, liveVerification: block, contactProgress: block });
  assert.equal(response.contractVersion, CONTRACT_VERSION);
  assert.equal(response.contractMetadata.actionCatalogVersion, OPERATIONAL_ACTION_CATALOG_VERSION);
  assert.equal(response.contractMetadata.compatibility.breakingChangesRequireNewEndpointOrMajorVersion, true);
  assert.equal(response.summary.availableActions.includes('future_tool_action'), true);
});
