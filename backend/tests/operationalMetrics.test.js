const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMetricsResponse, deriveHitMissRatio, parseRedisInfo } = require("../services/operationalObservability");

test("parseRedisInfo parses Redis INFO stats and memory numeric fields", () => {
  const parsed = parseRedisInfo(`# Stats\r\ntotal_commands_processed:42\r\nkeyspace_hits:30\r\nkeyspace_misses:10\r\nexpired_keys:3\r\nevicted_keys:1\r\n# Memory\r\nused_memory:1048576\r\nused_memory_peak:2097152\r\nredis_version:8.0.0\r\n`);

  assert.equal(parsed.total_commands_processed, 42);
  assert.equal(parsed.keyspace_hits, 30);
  assert.equal(parsed.keyspace_misses, 10);
  assert.equal(parsed.expired_keys, 3);
  assert.equal(parsed.evicted_keys, 1);
  assert.equal(parsed.used_memory, 1048576);
  assert.equal(parsed.used_memory_peak, 2097152);
  assert.equal(parsed.redis_version, "8.0.0");
});

test("deriveHitMissRatio derives percentage from Redis keyspace counters", () => {
  const result = deriveHitMissRatio({ keyspace_hits: 84, keyspace_misses: 16 });

  assert.deepEqual(result, {
    hits: 84,
    misses: 16,
    ratio: 84,
    status: "derived",
    note: "Derivado de Redis INFO stats keyspace_hits/keyspace_misses.",
  });
});

test("deriveHitMissRatio degrades when Redis INFO stats are unavailable", () => {
  const result = deriveHitMissRatio({ total_commands_processed: 10 });

  assert.equal(result.hits, null);
  assert.equal(result.misses, null);
  assert.equal(result.ratio, null);
  assert.equal(result.status, "not_instrumented");
  assert.match(result.note, /keyspace_hits/);
});


test("buildMetricsResponse serializes live, derived and not instrumented metric states", () => {
  const response = buildMetricsResponse({
    redis: {
      updatedAt: "2026-06-23T00:00:00.000Z",
      ping: { status: "live", latencyMs: 2 },
      stats: { keyspace_hits: 9, keyspace_misses: 1, total_commands_processed: 110, evicted_keys: 0, expired_keys: 2 },
      memory: { used_memory: 1048576, used_memory_peak: 2097152 },
      errors: {},
    },
    bullmq: { totals: { failed: 1, completed: 7, retryCount: 2 } },
    previousSnapshot: { bucketStartedAt: new Date(Date.now() - 60000), metrics: { redis: { stats: { total_commands_processed: 100 } }, bullmq: { totals: { completed: 5 } } } },
    persisted: { id: "snapshot" },
  });

  assert.equal(response.cacheAnalytics.hitMissRatio.instrumentationStatus, "derived");
  assert.equal(response.cacheAnalytics.hitMissRatio.value, 90);
  assert.equal(response.latencyAndTiming.pingLatency.instrumentationStatus, "live");
  assert.equal(response.expansion.redisMemory.usedMemory.value, 1);
  assert.equal(response.callsAndThroughput.redisCommandsPerMinute.instrumentationStatus, "derived");
  assert.equal(response.bytesAndSerialization.avgKeySize.instrumentationStatus, "not_instrumented");
});
