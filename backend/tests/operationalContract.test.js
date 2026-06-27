const test = require('node:test');
const assert = require('node:assert/strict');
const { buildConsolidatedOperationalResponse, buildFreshness, buildInvalidation, buildOperationalBlock, chooseDominantBlock, FRESHNESS_SOURCES } = require('../services/operational/contract');

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
