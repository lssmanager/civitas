const { and, desc, eq, gt, lt, notInArray } = require("drizzle-orm");
const { db } = require("../db/client");
const { operationalMetricSnapshots, organizationProfiles, syncOperations, syncOperationSteps } = require("../db/schema");
const { QUEUE_NAMES, createQueue, createRedisConnection, getRedisUrl } = require("../queues/config");

const TERMINAL_OK = new Set(["completed", "succeeded", "success"]);
const RUNNING = new Set(["running", "processing", "active"]);
const QUEUED = new Set(["queued", "pending", "waiting", "delayed"]);
const PARTIAL_FAILED = new Set(["partial_failed"]);
const FAILED = new Set(["failed", "error"]);
const DOWNSTREAM_PENDING = new Set(["not_linked", "pending", "conflict", "error"]);
const CANONICAL_OK = new Set(["bootstrapped", "synced", "reconciled"]);
const QUEUE_JOB_TYPES = Object.freeze(["wait", "active", "delayed", "failed"]);
const OWNER_SYSTEM_METRICS_WINDOW = "1m";
const RAW_SNAPSHOT_RETENTION_MS = Number(process.env.OPERATIONAL_METRICS_RAW_RETENTION_MS || 2 * 60 * 60 * 1000);
const HOURLY_SNAPSHOT_RETENTION_MS = Number(process.env.OPERATIONAL_METRICS_HOURLY_RETENTION_MS || 48 * 60 * 60 * 1000);
const SLOW_OPERATION_THRESHOLD_MS = Number(process.env.OPERATIONAL_METRICS_SLOW_OPERATION_MS || 50);

let workerHealthSnapshotCacheAt = 0;
let workerHealthSnapshotCache = null;
let workerHealthSnapshotPromise = null;

const safeMessage = (value, fallback = null) => {
  if (!value) return fallback;
  const message = typeof value === "string" ? value : value.message || value.error || JSON.stringify(value);
  return message.length > 280 ? `${message.slice(0, 277)}...` : message;
};

function classifyTechnicalHealth(technical = {}) {
  const queues = Array.isArray(technical.queues) ? technical.queues : [];
  const waiting = queues.reduce((sum, queue) => sum + Number(queue.waiting || queue.depth || 0), 0);
  const failedJobs = queues.reduce((sum, queue) => sum + Number(queue.failed || 0), 0);
  const oldestJobAgeSeconds = Math.max(0, ...queues.map((queue) => Number(queue.oldestJobAgeSeconds || 0)));
  const heartbeatStale = Boolean(technical.worker?.heartbeatStale);
  const redisOk = technical.redis?.status === "ok";

  if (!redisOk) {
    return {
      status: "degraded",
      severity: "critical",
      message: "La sincronización está degradada; no se puede confirmar conectividad con la cola operacional.",
      code: "redis_unavailable",
    };
  }
  if (heartbeatStale && waiting > 0) {
    return {
      status: "stalled",
      severity: "critical",
      message: "La sincronización está detenida; las solicitudes nuevas pueden quedar pendientes.",
      code: "worker_stale_with_backlog",
    };
  }
  if (heartbeatStale) {
    return {
      status: "degraded",
      severity: "warning",
      message: "El servicio de sincronización no reporta actividad reciente; revisa la vista técnica si aparecen pendientes.",
      code: "worker_stale",
    };
  }
  if (waiting >= 10 || oldestJobAgeSeconds >= 900) {
    return {
      status: "degraded",
      severity: "warning",
      message: "Hay pendientes de propagación acumulándose; el equipo puede revisarlos sin leer métricas de cola.",
      code: "backlog_growing",
    };
  }
  if (failedJobs > 0) {
    return {
      status: "attention",
      severity: "warning",
      message: "Hay trabajos técnicos fallidos; revisa incidentes funcionales y reintentos disponibles.",
      code: "failed_jobs_present",
    };
  }
  return { status: "healthy", severity: "success", message: "Sincronización operativa al día.", code: "healthy" };
}

function buildFallbackWorkerHealthSnapshot() {
  const heartbeatAt = process.env.SYNC_WORKER_HEARTBEAT_AT || null;
  const heartbeatStale = heartbeatAt
    ? Date.now() - new Date(heartbeatAt).getTime() > Number(process.env.SYNC_WORKER_HEARTBEAT_STALE_MS || 120000)
    : process.env.SYNC_WORKER_ENABLED === "true";
  const fallbackQueueName = process.env.SYNC_QUEUE_NAME || Object.values(QUEUE_NAMES)[0] || "sync";

  return {
    readiness: heartbeatStale || process.env.REDIS_STATUS === "error" ? "degraded" : "ready",
    worker: {
      heartbeatAt,
      heartbeatStale,
      source: "environment_or_future_worker_monitor",
    },
    redis: {
      status: process.env.REDIS_STATUS || "unknown",
      source: "environment_or_future_worker_monitor",
      urlConfigured: Boolean(getRedisUrl({ required: false })),
    },
    queues: [
      {
        name: fallbackQueueName,
        waiting: Number(process.env.SYNC_QUEUE_WAITING || 0),
        active: Number(process.env.SYNC_QUEUE_ACTIVE || 0),
        delayed: Number(process.env.SYNC_QUEUE_DELAYED || 0),
        failed: Number(process.env.SYNC_QUEUE_FAILED || 0),
        oldestJobAgeSeconds: Number(process.env.SYNC_QUEUE_OLDEST_JOB_AGE_SECONDS || 0),
      },
    ],
  };
}

async function loadQueueSnapshot(queueName, connection) {
  const queue = createQueue(queueName, connection);
  const counts = await queue.getJobCounts(...QUEUE_JOB_TYPES);
  const jobs = await queue.getJobs(QUEUE_JOB_TYPES, 0, 0, true);
  const oldestTimestamp = jobs.reduce((oldest, job) => {
    const timestamp = Number(job?.timestamp || 0);
    if (!timestamp) return oldest;
    if (!oldest) return timestamp;
    return Math.min(oldest, timestamp);
  }, 0);

  return {
    name: queueName,
    waiting: Number(counts.wait || 0),
    active: Number(counts.active || 0),
    delayed: Number(counts.delayed || 0),
    failed: Number(counts.failed || 0),
    oldestJobAgeSeconds: oldestTimestamp ? Math.max(0, Math.floor((Date.now() - oldestTimestamp) / 1000)) : 0,
  };
}

async function loadRealWorkerHealthSnapshot() {
  const fallback = buildFallbackWorkerHealthSnapshot();
  const redisUrl = getRedisUrl({ required: false });

  if (!redisUrl) {
    return {
      ...fallback,
      readiness: "degraded",
      redis: {
        status: "unknown",
        message: "REDIS_URL no está configurado; no se puede medir la cola operacional.",
        source: "runtime_env",
        urlConfigured: false,
      },
    };
  }

  let connection;
  try {
    connection = createRedisConnection();
    const pingStartedAt = Date.now();
    const pingResponse = await connection.ping();
    const latencyMs = Date.now() - pingStartedAt;
    const queues = await Promise.all(Object.values(QUEUE_NAMES).map((queueName) => loadQueueSnapshot(queueName, connection)));

    return {
      readiness: fallback.worker.heartbeatStale ? "degraded" : "ready",
      worker: fallback.worker,
      redis: {
        status: pingResponse === "PONG" ? "ok" : "error",
        latencyMs,
        source: "redis_ping_and_bullmq_queue_stats",
        urlConfigured: true,
      },
      queues,
    };
  } catch (error) {
    return {
      ...fallback,
      readiness: "degraded",
      redis: {
        status: "error",
        message: safeMessage(error, "Redis no disponible para colas operativas."),
        source: "redis_ping_and_bullmq_queue_stats",
        urlConfigured: true,
      },
    };
  } finally {
    if (connection) {
      await connection.quit().catch(() => {
        connection.disconnect();
      });
    }
  }
}

function refreshWorkerHealthSnapshot({ force = false } = {}) {
  if (workerHealthSnapshotPromise && !force) return workerHealthSnapshotPromise;

  workerHealthSnapshotPromise = loadRealWorkerHealthSnapshot()
    .then((snapshot) => {
      workerHealthSnapshotCache = snapshot;
      workerHealthSnapshotCacheAt = Date.now();
      return snapshot;
    })
    .catch((error) => {
      const fallback = buildFallbackWorkerHealthSnapshot();
      workerHealthSnapshotCache = {
        ...fallback,
        readiness: "degraded",
        redis: {
          status: "error",
          message: safeMessage(error, "Redis no disponible para colas operativas."),
          source: "redis_ping_and_bullmq_queue_stats",
          urlConfigured: Boolean(getRedisUrl({ required: false })),
        },
      };
      workerHealthSnapshotCacheAt = Date.now();
      return workerHealthSnapshotCache;
    })
    .finally(() => {
      workerHealthSnapshotPromise = null;
    });

  return workerHealthSnapshotPromise;
}

function getWorkerHealthSnapshot() {
  const cacheTtlMs = Number(process.env.SYNC_WORKER_HEALTH_CACHE_MS || 15000);
  const fallback = workerHealthSnapshotCache || buildFallbackWorkerHealthSnapshot();
  const cacheExpired = !workerHealthSnapshotCacheAt || Date.now() - workerHealthSnapshotCacheAt > cacheTtlMs;

  if (cacheExpired) {
    void refreshWorkerHealthSnapshot().catch(() => null);
  }

  return fallback;
}

async function loadWorkerHealthSnapshot() {
  return refreshWorkerHealthSnapshot({ force: true });
}

function summarizeOrganization(profile) {
  const canonicalStatus = profile.logtoSyncStatus || "pending";
  const downstreamStatus = profile.fluentcrmSyncStatus || "not_linked";
  const canonicalComplete = CANONICAL_OK.has(canonicalStatus);
  const downstreamComplete = ["linked", "synced"].includes(downstreamStatus);
  const hasConflict = downstreamStatus === "conflict";
  const error = safeMessage(profile.fluentcrmSyncError || profile.logtoSyncError);
  const bootstrapStatus = !canonicalComplete ? canonicalStatus : downstreamComplete ? "completed" : hasConflict ? "partial_failed" : "running";
  return {
    organizationId: profile.logtoOrganizationId,
    profileId: profile.id,
    name: profile.nameCache,
    bootstrapStatus,
    canonicalStatus,
    downstreamStatus,
    currentStep: !canonicalComplete ? "canonical" : downstreamComplete ? "completed" : "downstream",
    lastFunctionalError: error,
    retryable: Boolean(error) || DOWNSTREAM_PENDING.has(downstreamStatus),
    conflictType: hasConflict ? "downstream_propagation_conflict" : null,
  };
}

function buildOperationsSummary({ operations = [], steps = [], profiles = [], technicalHealth, incidentsLimit = 5 } = {}) {
  const counts = { queued: 0, running: 0, partialFailed: 0, failed: 0, retryable: 0, organizationsWithPendingDownstreamSync: 0 };
  for (const operation of operations) {
    const status = operation.status;
    if (QUEUED.has(status)) counts.queued += 1;
    if (RUNNING.has(status)) counts.running += 1;
    if (PARTIAL_FAILED.has(status)) counts.partialFailed += 1;
    if (FAILED.has(status)) counts.failed += 1;
    if (operation.retryable || operation.nextRetryAt) counts.retryable += 1;
  }
  const organizations = profiles.map(summarizeOrganization);
  counts.organizationsWithPendingDownstreamSync = organizations.filter((org) => org.currentStep === "downstream" && org.downstreamStatus !== "linked" && org.downstreamStatus !== "synced").length;
  const incidents = [
    ...organizations
      .filter((org) => org.lastFunctionalError || org.conflictType)
      .map((org) => ({
        type: org.conflictType || "sync_error",
        organizationId: org.organizationId,
        organizationName: org.name,
        message: org.lastFunctionalError || "Hay un conflicto de sincronización por resolver.",
        retryable: org.retryable,
      })),
    ...steps
      .filter((step) => step.errorMessage || step.status === "failed")
      .map((step) => ({
        type: "operation_step_failed",
        organizationId: step.organizationId || null,
        organizationName: null,
        message: safeMessage(step.errorMessage, `Falló el paso ${step.stepName || step.name || "de sincronización"}.`),
        retryable: Boolean(step.retryable),
      })),
  ].slice(0, incidentsLimit);
  const functionalHealth = classifyTechnicalHealth(technicalHealth);
  if (counts.partialFailed > 0 || counts.failed > 0 || counts.organizationsWithPendingDownstreamSync > 0) {
    functionalHealth.status = functionalHealth.status === "healthy" ? "attention" : functionalHealth.status;
    functionalHealth.severity = functionalHealth.severity === "success" ? "warning" : functionalHealth.severity;
    functionalHealth.message = counts.organizationsWithPendingDownstreamSync > 0
      ? "Hay organizaciones creadas canónicamente con sincronización externa incompleta."
      : "Hay fallos funcionales de sincronización que requieren revisión.";
  }
  return {
    counts,
    functionalHealth,
    incidents,
    organizations: organizations.filter((org) => org.retryable || org.currentStep !== "completed"),
  };
}

const metric = ({ value = null, unit = "count", instrumentationStatus = "not_instrumented", source = "civitas_operational", window = OWNER_SYSTEM_METRICS_WINDOW, updatedAt = new Date().toISOString(), note = null } = {}) => ({
  value,
  unit,
  instrumentationStatus,
  source,
  window,
  updatedAt,
  ...(note ? { note } : {}),
});

function parseRedisInfo(info = "") {
  return String(info)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .reduce((parsed, line) => {
      const separator = line.indexOf(":");
      if (separator === -1) return parsed;
      const key = line.slice(0, separator);
      const rawValue = line.slice(separator + 1);
      const numericValue = Number(rawValue);
      parsed[key] = Number.isFinite(numericValue) && rawValue !== "" ? numericValue : rawValue;
      return parsed;
    }, {});
}

function deriveHitMissRatio(stats = {}) {
  const hits = Number(stats.keyspace_hits);
  const misses = Number(stats.keyspace_misses);
  if (!Number.isFinite(hits) || !Number.isFinite(misses)) {
    return { hits: null, misses: null, ratio: null, status: "not_instrumented", note: "Redis INFO stats no expone keyspace_hits/keyspace_misses en este entorno." };
  }
  const total = hits + misses;
  return { hits, misses, ratio: total > 0 ? Number(((hits / total) * 100).toFixed(2)) : 0, status: "derived", note: "Derivado de Redis INFO stats keyspace_hits/keyspace_misses." };
}

const toMinuteBucket = (date = new Date()) => new Date(Math.floor(date.getTime() / 60000) * 60000);
const bytesToMb = (value) => Number.isFinite(Number(value)) ? Number((Number(value) / 1024 / 1024).toFixed(2)) : null;

async function readRecentOperationalSnapshots(limit = 2, { bucket = "minute", source = "redis_bullmq" } = {}) {
  if (!operationalMetricSnapshots) return [];
  try {
    return await db
      .select()
      .from(operationalMetricSnapshots)
      .where(and(eq(operationalMetricSnapshots.bucket, bucket), eq(operationalMetricSnapshots.source, source)))
      .orderBy(desc(operationalMetricSnapshots.bucketStartedAt))
      .limit(limit);
  } catch (error) {
    console.warn("Operational metric snapshot history unavailable", { message: safeMessage(error) });
    return [];
  }
}

async function persistOperationalSnapshot(snapshot) {
  if (!operationalMetricSnapshots) return null;
  try {
    const [row] = await db.insert(operationalMetricSnapshots).values(snapshot).returning();
    return row;
  } catch (error) {
    console.warn("Operational metric snapshot persistence skipped", { message: safeMessage(error) });
    return null;
  }
}


const toHourBucket = (date = new Date()) => new Date(Math.floor(date.getTime() / 3600000) * 3600000);
const readPath = (object, path) => path.reduce((value, key) => value?.[key], object);

function aggregateSnapshotsToBucket(snapshots = [], bucketStartedAt = toHourBucket()) {
  const sorted = [...snapshots].sort((a, b) => new Date(a.bucketStartedAt).getTime() - new Date(b.bucketStartedAt).getTime());
  const first = sorted[0]?.metrics || {};
  const last = sorted.at(-1)?.metrics || {};
  const bucketWindowMinutes = sorted.length > 1
    ? Math.max(1 / 60, (new Date(sorted.at(-1).bucketStartedAt).getTime() - new Date(sorted[0].bucketStartedAt).getTime()) / 60000)
    : 60;
  const redisCommandDelta = Math.max(0, Number(readPath(last, ["redis", "stats", "total_commands_processed"]) || 0) - Number(readPath(first, ["redis", "stats", "total_commands_processed"]) || 0));
  const bullmqCompletedDelta = Math.max(0, Number(readPath(last, ["bullmq", "totals", "completed"]) || 0) - Number(readPath(first, ["bullmq", "totals", "completed"]) || 0));
  const retrySamples = sorted.map((snapshot) => Number(readPath(snapshot.metrics || {}, ["bullmq", "totals", "retryCount"]) || 0));
  const completedSamples = sorted.map((snapshot) => Number(readPath(snapshot.metrics || {}, ["bullmq", "totals", "recentCompleted"]) || 0));
  const latencySamples = sorted.flatMap((snapshot) => snapshot.metrics?.redis?.latencySamples || []).filter((sample) => Number.isFinite(Number(sample?.latencyMs)));
  return {
    bucketStartedAt: bucketStartedAt.toISOString(),
    sampleCount: sorted.length,
    redis: {
      commandsProcessedDelta: redisCommandDelta,
      commandsPerMinute: Number((redisCommandDelta / bucketWindowMinutes).toFixed(2)),
      usedMemory: readPath(last, ["redis", "memory", "used_memory"]) ?? null,
      usedMemoryPeak: readPath(last, ["redis", "memory", "used_memory_peak"]) ?? null,
      latencySamples,
    },
    bullmq: {
      completedDelta: bullmqCompletedDelta,
      jobsPerMinute: Number((bullmqCompletedDelta / bucketWindowMinutes).toFixed(2)),
      retryNumerator: Math.max(0, ...retrySamples, 0),
      retryDenominator: Math.max(0, ...completedSamples, 0),
      failed: readPath(last, ["bullmq", "totals", "failed"]) ?? null,
    },
  };
}

function percentile(values = [], percentileValue = 95) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return Number(sorted[index].toFixed(2));
}

function summarizeLatencySamples(samples = []) {
  const values = samples.map((sample) => Number(sample.latencyMs)).filter(Number.isFinite);
  if (!values.length) return { avg: null, p95: null, p99: null, slowCount: null, sampleCount: 0 };
  const avg = Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
  return { avg, p95: values.length >= 20 ? percentile(values, 95) : null, p99: values.length >= 100 ? percentile(values, 99) : null, slowCount: values.filter((value) => value >= SLOW_OPERATION_THRESHOLD_MS).length, sampleCount: values.length };
}

function buildThroughputSeriesFromSnapshots(snapshots = [], { points = 8 } = {}) {
  const sorted = [...snapshots].sort((a, b) => new Date(a.bucketStartedAt).getTime() - new Date(b.bucketStartedAt).getTime());
  const series = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const minutes = Math.max(1 / 60, (new Date(current.bucketStartedAt).getTime() - new Date(previous.bucketStartedAt).getTime()) / 60000);
    const redisDelta = Math.max(0, Number(readPath(current.metrics || {}, ["redis", "stats", "total_commands_processed"]) || 0) - Number(readPath(previous.metrics || {}, ["redis", "stats", "total_commands_processed"]) || 0));
    const bullmqDelta = Math.max(0, Number(readPath(current.metrics || {}, ["bullmq", "totals", "completed"]) || 0) - Number(readPath(previous.metrics || {}, ["bullmq", "totals", "completed"]) || 0));
    series.push({
      at: current.bucketStartedAt?.toISOString?.() ?? current.bucketStartedAt,
      redisCommandsPerMinute: Number((redisDelta / minutes).toFixed(2)),
      bullmqJobsPerMinute: Number((bullmqDelta / minutes).toFixed(2)),
      sampleWindowMinutes: Number(minutes.toFixed(2)),
    });
  }
  return series.slice(-points);
}

async function runOperationalMetricsRollup({ now = new Date() } = {}) {
  if (!operationalMetricSnapshots) return { status: "not_instrumented", rolledUpHours: 0, retained: false };
  try {
    const since = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    const minuteSnapshots = await db
      .select()
      .from(operationalMetricSnapshots)
      .where(and(eq(operationalMetricSnapshots.bucket, "minute"), eq(operationalMetricSnapshots.source, "redis_bullmq"), gt(operationalMetricSnapshots.bucketStartedAt, since)))
      .orderBy(desc(operationalMetricSnapshots.bucketStartedAt))
      .limit(2000);
    const byHour = new Map();
    for (const snapshot of minuteSnapshots) {
      const hour = toHourBucket(new Date(snapshot.bucketStartedAt)).toISOString();
      byHour.set(hour, [...(byHour.get(hour) || []), snapshot]);
    }
    let rolledUpHours = 0;
    for (const [hour, snapshots] of byHour.entries()) {
      if (snapshots.length < 2) continue;
      await persistOperationalSnapshot({ bucket: "hour", bucketStartedAt: new Date(hour), source: "redis_bullmq_rollup", metrics: aggregateSnapshotsToBucket(snapshots, new Date(hour)) });
      rolledUpHours += 1;
    }
    await db.delete(operationalMetricSnapshots).where(and(eq(operationalMetricSnapshots.bucket, "minute"), lt(operationalMetricSnapshots.bucketStartedAt, new Date(now.getTime() - RAW_SNAPSHOT_RETENTION_MS)))).catch(() => null);
    await db.delete(operationalMetricSnapshots).where(and(eq(operationalMetricSnapshots.bucket, "hour"), lt(operationalMetricSnapshots.bucketStartedAt, new Date(now.getTime() - HOURLY_SNAPSHOT_RETENTION_MS)))).catch(() => null);
    return { status: "ok", rolledUpHours, retained: true };
  } catch (error) {
    console.warn("Operational metric rollup skipped", { message: safeMessage(error) });
    return { status: "error", rolledUpHours: 0, retained: false, message: safeMessage(error) };
  }
}

function deriveDeltaPerMinute(currentValue, previousSnapshot, path) {
  const previousMetrics = previousSnapshot?.metrics || {};
  const previousValue = path.reduce((value, key) => value?.[key], previousMetrics);
  const previousAt = previousSnapshot?.bucketStartedAt ? new Date(previousSnapshot.bucketStartedAt).getTime() : null;
  if (!Number.isFinite(Number(currentValue)) || !Number.isFinite(Number(previousValue)) || !previousAt) return null;
  const minutes = Math.max(1 / 60, (Date.now() - previousAt) / 60000);
  return Number(Math.max(0, (Number(currentValue) - Number(previousValue)) / minutes).toFixed(2));
}

async function collectRedisMetrics(connection) {
  const updatedAt = new Date().toISOString();
  const latencySamples = [];
  const timed = async (operation, run) => {
    const started = Date.now();
    try {
      return await run();
    } finally {
      latencySamples.push({ operation, latencyMs: Date.now() - started });
    }
  };
  const ping = await timed("PING", () => connection.ping());
  const [statsRaw, memoryRaw] = await Promise.all([
    timed("INFO stats", () => connection.info("stats")).catch((error) => ({ error })),
    timed("INFO memory", () => connection.info("memory")).catch((error) => ({ error })),
  ]);
  const stats = typeof statsRaw === "string" ? parseRedisInfo(statsRaw) : null;
  const memory = typeof memoryRaw === "string" ? parseRedisInfo(memoryRaw) : null;
  return {
    updatedAt,
    ping: { status: ping === "PONG" ? "live" : "not_instrumented", latencyMs: latencySamples.find((sample) => sample.operation === "PING")?.latencyMs ?? null },
    stats,
    memory,
    latencySamples,
    latencySummary: summarizeLatencySamples(latencySamples),
    errors: {
      stats: stats ? null : safeMessage(statsRaw.error, "Redis INFO stats no disponible."),
      memory: memory ? null : safeMessage(memoryRaw.error, "Redis INFO memory no disponible."),
    },
  };
}

async function collectBullMqMetrics(connection) {
  const queues = await Promise.all(Object.values(QUEUE_NAMES).map(async (queueName) => {
    const queue = createQueue(queueName, connection);
    const counts = await queue.getJobCounts("wait", "active", "delayed", "failed", "completed");
    const recentJobs = await queue.getJobs(["completed", "failed"], 0, 99, false).catch(() => []);
    const now = Date.now();
    const recentWindowMs = 60 * 60 * 1000;
    const recentCompleted = recentJobs.filter((job) => job.finishedOn && now - Number(job.finishedOn) <= recentWindowMs && !job.failedReason).length;
    const recentFailed = recentJobs.filter((job) => job.finishedOn && now - Number(job.finishedOn) <= recentWindowMs && job.failedReason).length;
    const retryCount = recentJobs.reduce((sum, job) => sum + Math.max(0, Number(job.attemptsMade || 0) - 1), 0);
    return {
      name: queueName,
      waiting: Number(counts.wait || 0),
      active: Number(counts.active || 0),
      delayed: Number(counts.delayed || 0),
      failed: Number(counts.failed || 0),
      completed: Number(counts.completed || 0),
      recentCompleted,
      recentFailed,
      retryCount,
    };
  }));
  return {
    queues,
    totals: queues.reduce((total, queue) => ({
      waiting: total.waiting + queue.waiting,
      active: total.active + queue.active,
      delayed: total.delayed + queue.delayed,
      failed: total.failed + queue.failed,
      completed: total.completed + queue.completed,
      recentCompleted: total.recentCompleted + queue.recentCompleted,
      retryCount: total.retryCount + queue.retryCount,
    }), { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0, recentCompleted: 0, retryCount: 0 }),
  };
}

function buildMetricsResponse({ redis, bullmq, previousSnapshot, persisted, minuteSnapshots = [], hourlyRollups = [], rollup = null }) {
  const updatedAt = redis?.updatedAt || new Date().toISOString();
  const hitMiss = deriveHitMissRatio(redis?.stats || {});
  const minuteSeries = buildThroughputSeriesFromSnapshots(minuteSnapshots);
  const latestMinutePoint = minuteSeries.at(-1);
  const commandThroughput = latestMinutePoint?.redisCommandsPerMinute ?? deriveDeltaPerMinute(redis?.stats?.total_commands_processed, previousSnapshot, ["redis", "stats", "total_commands_processed"]);
  const jobThroughput = latestMinutePoint?.bullmqJobsPerMinute ?? deriveDeltaPerMinute(bullmq?.totals?.completed, previousSnapshot, ["bullmq", "totals", "completed"]);
  const hourlySeries = [...hourlyRollups].sort((a, b) => new Date(a.bucketStartedAt).getTime() - new Date(b.bucketStartedAt).getTime()).map((snapshot) => ({ at: snapshot.bucketStartedAt?.toISOString?.() ?? snapshot.bucketStartedAt, redisCommandsPerMinute: snapshot.metrics?.redis?.commandsPerMinute ?? null, bullmqJobsPerMinute: snapshot.metrics?.bullmq?.jobsPerMinute ?? null, sampleCount: snapshot.metrics?.sampleCount ?? 0 }));
  const failedJobs = bullmq?.totals?.failed ?? null;
  const retryNumerator = Math.max(Number(bullmq?.totals?.retryCount || 0), ...hourlyRollups.map((snapshot) => Number(snapshot.metrics?.bullmq?.retryNumerator || 0)), 0);
  const retryDenominator = Math.max(Number(bullmq?.totals?.recentCompleted || 0), ...hourlyRollups.map((snapshot) => Number(snapshot.metrics?.bullmq?.retryDenominator || 0)), 0);
  const retryRate = retryDenominator > 0 ? Number(((retryNumerator / retryDenominator) * 100).toFixed(2)) : null;
  const latencySummary = summarizeLatencySamples([...(redis?.latencySamples || []), ...minuteSnapshots.flatMap((snapshot) => snapshot.metrics?.redis?.latencySamples || [])]);
  const usedMemoryMb = bytesToMb(redis?.memory?.used_memory);
  const usedMemoryPeakMb = bytesToMb(redis?.memory?.used_memory_peak);

  return {
    checkedAt: updatedAt,
    persistence: {
      status: persisted ? "sampled" : "not_instrumented",
      source: "postgres.operational_metric_snapshots",
      note: persisted ? "Snapshot operativo agregado guardado en PostgreSQL; no es canon de negocio." : "La tabla de snapshots no está disponible o la inserción fue omitida.",
    },
    cacheAnalytics: {
      hitMissRatio: metric({ value: hitMiss.ratio, unit: "percent", instrumentationStatus: hitMiss.status, source: "redis.info.stats", updatedAt, note: hitMiss.note }),
      hits: metric({ value: hitMiss.hits, unit: "count", instrumentationStatus: hitMiss.status === "derived" ? "live" : hitMiss.status, source: "redis.info.stats.keyspace_hits", updatedAt, note: redis?.errors?.stats }),
      misses: metric({ value: hitMiss.misses, unit: "count", instrumentationStatus: hitMiss.status === "derived" ? "live" : hitMiss.status, source: "redis.info.stats.keyspace_misses", updatedAt, note: redis?.errors?.stats }),
      prefetchHit: metric({ instrumentationStatus: "not_instrumented", source: "civitas.cache_policy", updatedAt, note: "No existe todavía una política de prefetch instrumentada." }),
      coldMiss: metric({ instrumentationStatus: "not_instrumented", source: "civitas.cache_policy", updatedAt, note: "Redis keyspace_misses mide misses globales, no cold miss semántico por política Civitas." }),
      stale: metric({ instrumentationStatus: "not_instrumented", source: "civitas.cache_policy", updatedAt, note: "No hay trazabilidad de stale reads instrumentada." }),
    },
    latencyAndTiming: {
      pingLatency: metric({ value: redis?.ping?.latencyMs ?? null, unit: "ms", instrumentationStatus: redis?.ping?.status || "not_instrumented", source: "redis.ping", updatedAt }),
      avg: metric({ value: latencySummary.avg, instrumentationStatus: latencySummary.sampleCount ? "sampled" : "not_instrumented", unit: "ms", source: "redis.controlled_sampler(PING,INFO)", updatedAt, note: latencySummary.sampleCount ? `Muestra controlada de ${latencySummary.sampleCount} operaciones Redis internas al dashboard.` : "No hay muestras de latencia disponibles." }),
      p95: metric({ value: latencySummary.p95, instrumentationStatus: latencySummary.p95 === null ? "sampled" : "derived", unit: "ms", source: "redis.controlled_sampler(PING,INFO)", updatedAt, note: latencySummary.p95 === null ? "Se requieren al menos 20 muestras para p95 confiable." : null }),
      p99: metric({ value: latencySummary.p99, instrumentationStatus: latencySummary.p99 === null ? "sampled" : "derived", unit: "ms", source: "redis.controlled_sampler(PING,INFO)", updatedAt, note: latencySummary.p99 === null ? "Se requieren al menos 100 muestras para p99 confiable." : null }),
    },
    bytesAndSerialization: {
      avgKeySize: metric({ instrumentationStatus: "not_instrumented", unit: "bytes", source: "civitas.serialization", updatedAt, note: "Requiere instrumentar serialización/tamaño de payload por key." }),
      rawVsCompressed: metric({ instrumentationStatus: "not_instrumented", unit: "ratio", source: "civitas.serialization", updatedAt, note: "No existe medición raw/compressed en la capa de serialización." }),
      compressionRatio: metric({ instrumentationStatus: "not_instrumented", unit: "ratio", source: "civitas.serialization", updatedAt, note: "Propuesto para siguiente iteración." }),
    },
    callsAndThroughput: {
      redisCommandsProcessed: metric({ value: redis?.stats?.total_commands_processed ?? null, unit: "count", instrumentationStatus: redis?.stats ? "live" : "not_instrumented", source: "redis.info.stats.total_commands_processed", updatedAt, note: redis?.errors?.stats }),
      redisCommandsPerMinute: metric({ value: commandThroughput, unit: "ops/min", instrumentationStatus: commandThroughput === null ? "sampled" : "derived", source: "postgres.operational_metric_snapshots.series.delta(redis.info.stats.total_commands_processed)", updatedAt, note: commandThroughput === null ? "Se requiere más historia de snapshots para derivar throughput por ventana." : null }),
      bullmqJobsPerMinute: metric({ value: jobThroughput, unit: "jobs/min", instrumentationStatus: jobThroughput === null ? "sampled" : "derived", source: "postgres.operational_metric_snapshots.series.delta(bullmq.completed)", updatedAt, note: jobThroughput === null ? "Se requiere más historia de snapshots para derivar throughput por ventana." : null }),
      totalBullmqCompleted: metric({ value: bullmq?.totals?.completed ?? null, unit: "jobs", instrumentationStatus: bullmq ? "live" : "not_instrumented", source: "bullmq.getJobCounts.completed", updatedAt }),
    },
    debugAndLogging: {
      redisOps: metric({ value: redis?.stats?.total_commands_processed ?? null, unit: "count", instrumentationStatus: redis?.stats ? "live" : "not_instrumented", source: "redis.info.stats", updatedAt }),
      bullmqJobs: metric({ value: bullmq?.totals?.completed ?? null, unit: "jobs", instrumentationStatus: bullmq ? "live" : "not_instrumented", source: "bullmq.getJobCounts", updatedAt }),
      failedJobs: metric({ value: failedJobs, unit: "jobs", instrumentationStatus: bullmq ? "live" : "not_instrumented", source: "bullmq.getJobCounts.failed", updatedAt }),
      retryRate: metric({ value: retryRate, unit: "percent", instrumentationStatus: retryRate === null ? "sampled" : "derived", source: "postgres.operational_metric_snapshots.rollup(bullmq.retry_attempts/completed_jobs)", window: "rolling 24h when history exists", updatedAt, note: retryRate === null ? "No hay denominador suficiente para retry rate; se expone numerador/denominador en raw." : `Numerador ${retryNumerator}, denominador ${retryDenominator}. Cobertura limitada a jobs retenidos por BullMQ y snapshots disponibles.` }),
      slowQueries: metric({ value: latencySummary.slowCount, instrumentationStatus: latencySummary.sampleCount ? "sampled" : "not_instrumented", unit: "operations", source: "redis.controlled_sampler.threshold", updatedAt, note: `Aproximación barata: operaciones muestreadas >= ${SLOW_OPERATION_THRESHOLD_MS}ms; no usa SLOWLOG para evitar payload/overhead.` }),
    },
    expansion: {
      redisMemory: {
        usedMemory: metric({ value: usedMemoryMb, unit: "MB", instrumentationStatus: usedMemoryMb === null ? "not_instrumented" : "live", source: "redis.info.memory.used_memory", updatedAt, note: redis?.errors?.memory }),
        usedMemoryPeak: metric({ value: usedMemoryPeakMb, unit: "MB", instrumentationStatus: usedMemoryPeakMb === null ? "not_instrumented" : "live", source: "redis.info.memory.used_memory_peak", updatedAt, note: redis?.errors?.memory }),
        evictedKeys: metric({ value: redis?.stats?.evicted_keys ?? null, unit: "keys", instrumentationStatus: redis?.stats ? "live" : "not_instrumented", source: "redis.info.stats.evicted_keys", updatedAt }),
        expiredKeys: metric({ value: redis?.stats?.expired_keys ?? null, unit: "keys", instrumentationStatus: redis?.stats ? "live" : "not_instrumented", source: "redis.info.stats.expired_keys", updatedAt }),
      },
      ttlDistribution: metric({ instrumentationStatus: "not_instrumented", source: "redis.scan.ttl", updatedAt, note: "Requiere muestreo SCAN/TTL controlado por namespace." }),
      retryRate: metric({ value: retryRate, unit: "percent", instrumentationStatus: retryRate === null ? "sampled" : "derived", source: "postgres.operational_metric_snapshots.rollup", updatedAt, note: `Numerador ${retryNumerator}; denominador ${retryDenominator}.` }),
      throughput24h: metric({ value: hourlySeries.length ? hourlySeries.reduce((sum, point) => sum + Number(point.redisCommandsPerMinute || 0), 0) : null, instrumentationStatus: hourlySeries.length >= 2 ? "derived" : "sampled", unit: "ops/min cumulative", source: "postgres.operational_metric_snapshots.hour", window: "24h", updatedAt, note: hourlySeries.length >= 2 ? `${hourlySeries.length} buckets horarios disponibles.` : "Historia insuficiente tras deploy; se requieren buckets horarios para 24h real." }),
      perOrganization: metric({ instrumentationStatus: "not_instrumented", source: "logto_organization_id_attribution", updatedAt, note: "No hay atribución confiable por logto_organization_id para operaciones Redis/cache." }),
      alerts: metric({ instrumentationStatus: "proposed", source: "civitas.alert_rules", updatedAt, note: "Umbrales propuestos: miss > 20%, p99 > 10ms, failed jobs > 0." }),
    },
    series: {
      last8: minuteSeries,
      throughput24h: hourlySeries.slice(-24),
      rollup,
    },
    raw: {
      redis: { stats: redis?.stats || null, memory: redis?.memory || null, latencySamples: redis?.latencySamples || [] },
      bullmq: { ...bullmq, retryNumerator, retryDenominator },
    },
  };
}

async function loadOwnerSystemMetrics() {
  const redisUrl = getRedisUrl({ required: false });
  const updatedAt = new Date();
  const previousSnapshots = await readRecentOperationalSnapshots(16);
  const hourlyRollups = await readRecentOperationalSnapshots(24, { bucket: "hour", source: "redis_bullmq_rollup" });

  if (!redisUrl) {
    const response = buildMetricsResponse({ redis: { updatedAt: updatedAt.toISOString(), errors: { stats: "REDIS_URL no configurado.", memory: "REDIS_URL no configurado." } }, bullmq: null, previousSnapshot: previousSnapshots[0], persisted: null, minuteSnapshots: previousSnapshots, hourlyRollups });
    response.status = "degraded";
    response.note = "REDIS_URL no está configurado; métricas Redis/BullMQ no disponibles.";
    return response;
  }

  let connection;
  try {
    connection = createRedisConnection();
    const [redis, bullmq] = await Promise.all([collectRedisMetrics(connection), collectBullMqMetrics(connection)]);
    const snapshot = {
      bucket: "minute",
      bucketStartedAt: toMinuteBucket(updatedAt),
      source: "redis_bullmq",
      metrics: {
        redis: { stats: redis.stats || {}, memory: redis.memory || {}, pingLatencyMs: redis.ping.latencyMs, latencySamples: redis.latencySamples || [] },
        bullmq,
      },
    };
    const persisted = await persistOperationalSnapshot(snapshot);
    const rollup = await runOperationalMetricsRollup({ now: updatedAt });
    const refreshedMinutes = persisted ? [persisted, ...previousSnapshots] : previousSnapshots;
    const refreshedHours = await readRecentOperationalSnapshots(24, { bucket: "hour", source: "redis_bullmq_rollup" });
    const response = buildMetricsResponse({ redis, bullmq, previousSnapshot: previousSnapshots[0], persisted, minuteSnapshots: refreshedMinutes, hourlyRollups: refreshedHours, rollup });
    response.status = "ok";
    return response;
  } catch (error) {
    const response = buildMetricsResponse({ redis: { updatedAt: updatedAt.toISOString(), errors: { stats: safeMessage(error), memory: safeMessage(error) } }, bullmq: null, previousSnapshot: previousSnapshots[0], persisted: null, minuteSnapshots: previousSnapshots, hourlyRollups });
    response.status = "degraded";
    response.note = safeMessage(error, "No se pudieron recolectar métricas Redis/BullMQ.");
    return response;
  } finally {
    if (connection) {
      await connection.quit().catch(() => connection.disconnect());
    }
  }
}

async function loadOperationsSummary() {
  const [profiles, operations, steps, technicalHealth] = await Promise.all([
    db.select().from(organizationProfiles),
    syncOperations ? db.select().from(syncOperations).where(notInArray(syncOperations.status, ["completed", "succeeded", "success", "failed"])).orderBy(desc(syncOperations.updatedAt)).catch(() => []) : [],
    syncOperationSteps ? db.select().from(syncOperationSteps).where(notInArray(syncOperationSteps.status, ["completed", "succeeded", "success", "skipped", "unsupported"])).orderBy(desc(syncOperationSteps.updatedAt)).catch(() => []) : [],
    loadWorkerHealthSnapshot(),
  ]);
  return buildOperationsSummary({ profiles, operations, steps, technicalHealth });
}

void refreshWorkerHealthSnapshot().catch(() => null);

module.exports = {
  buildOperationsSummary,
  classifyTechnicalHealth,
  getWorkerHealthSnapshot,
  aggregateSnapshotsToBucket,
  buildThroughputSeriesFromSnapshots,
  runOperationalMetricsRollup,
  summarizeLatencySamples,
  buildMetricsResponse,
  deriveHitMissRatio,
  loadOperationsSummary,
  loadOwnerSystemMetrics,
  parseRedisInfo,
  loadWorkerHealthSnapshot,
  summarizeOrganization,
};
