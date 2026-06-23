const test = require("node:test");
const assert = require("node:assert/strict");
const {
  aggregateSnapshotsToBucket,
  buildMetricsResponse,
  buildThroughputSeriesFromSnapshots,
  deriveHitMissRatio,
  parseRedisInfo,
  summarizeLatencySamples,
} = require("../services/operationalObservability");

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

test("aggregateSnapshotsToBucket rolls minute snapshots into one operational bucket", () => {
  const bucketStartedAt = new Date("2026-06-23T00:00:00.000Z");
  const snapshots = [
    {
      bucketStartedAt,
      metrics: {
        redis: {
          stats: { total_commands_processed: 100 },
          memory: { used_memory: 1048576, used_memory_peak: 2097152 },
          latencySamples: [{ operation: "PING", latencyMs: 2, status: "ok" }],
        },
        bullmq: { totals: { completed: 5, retryCount: 1, recentCompleted: 4, failed: 0 } },
      },
    },
    {
      bucketStartedAt: new Date("2026-06-23T00:30:00.000Z"),
      metrics: {
        redis: {
          stats: { total_commands_processed: 220 },
          memory: { used_memory: 2097152, used_memory_peak: 3145728 },
          latencySamples: [{ operation: "INFO stats", latencyMs: 60, status: "ok" }],
        },
        bullmq: { totals: { completed: 11, retryCount: 3, recentCompleted: 8, failed: 1 } },
      },
    },
  ];

  const rollup = aggregateSnapshotsToBucket(snapshots, bucketStartedAt);

  assert.equal(rollup.redis.commandsProcessedDelta, 120);
  assert.equal(rollup.redis.commandsPerMinute, 4);
  assert.equal(rollup.redis.usedMemory, 2097152);
  assert.equal(rollup.redis.usedMemoryPeak, 3145728);
  assert.equal(rollup.redis.latencySamples.length, 2);
  assert.equal(rollup.bullmq.completedDelta, 6);
  assert.equal(rollup.bullmq.jobsPerMinute, 0.2);
  assert.equal(rollup.bullmq.retryNumerator, 3);
  assert.equal(rollup.bullmq.retryDenominator, 8);
  assert.equal(rollup.bullmq.failed, 1);
});

test("buildThroughputSeriesFromSnapshots derives window throughput without inventing history", () => {
  const snapshots = [
    {
      bucketStartedAt: new Date("2026-06-23T00:00:00.000Z"),
      metrics: { redis: { stats: { total_commands_processed: 100 } }, bullmq: { totals: { completed: 5 } } },
    },
    {
      bucketStartedAt: new Date("2026-06-23T00:30:00.000Z"),
      metrics: { redis: { stats: { total_commands_processed: 220 } }, bullmq: { totals: { completed: 11 } } },
    },
  ];

  const series = buildThroughputSeriesFromSnapshots(snapshots);

  assert.equal(series.length, 1);
  assert.equal(series[0].redisCommandsPerMinute, 4);
  assert.equal(series[0].bullmqJobsPerMinute, 0.2);
  assert.equal(series[0].sampleWindowMinutes, 30);
});

test("summarizeLatencySamples keeps p95 and p99 honest until sample sizes are reliable", () => {
  const smallSample = summarizeLatencySamples(Array.from({ length: 19 }, (_, index) => ({ latencyMs: index + 1 })));
  const p95Sample = summarizeLatencySamples(Array.from({ length: 20 }, (_, index) => ({ latencyMs: index + 1 })));
  const p99Sample = summarizeLatencySamples(Array.from({ length: 100 }, (_, index) => ({ latencyMs: index + 1 })));

  assert.equal(smallSample.avg, 10);
  assert.equal(smallSample.p95, null);
  assert.equal(p95Sample.p95, 19);
  assert.equal(p95Sample.p99, null);
  assert.equal(p99Sample.p99, 99);
});

test("buildMetricsResponse degrades throughput and 24h series when history is insufficient", () => {
  const response = buildMetricsResponse({
    redis: {
      updatedAt: "2026-06-23T00:00:00.000Z",
      ping: { status: "live", latencyMs: 2 },
      stats: { keyspace_hits: 0, keyspace_misses: 0, total_commands_processed: 110 },
      memory: {},
      errors: {},
    },
    bullmq: { totals: { failed: 0, completed: 7, retryCount: 0 } },
    previousSnapshot: null,
    persisted: null,
    minuteSnapshots: [],
    hourlyRollups: [],
  });

  assert.equal(response.callsAndThroughput.redisCommandsPerMinute.value, null);
  assert.equal(response.callsAndThroughput.redisCommandsPerMinute.instrumentationStatus, "sampled");
  assert.equal(response.expansion.throughput24h.value, null);
  assert.equal(response.expansion.throughput24h.instrumentationStatus, "sampled");
  assert.deepEqual(response.series.last8, []);
  assert.deepEqual(response.series.throughput24h, []);
});
