const { and, desc, eq, gt, lt } = require("drizzle-orm");
const { db } = require("../db/client");
const { auditLogs, operationalMetricSnapshots, organizationProfiles, syncOperations, syncOperationSteps } = require("../db/schema");
const { QUEUE_NAMES, createQueue, createRedisConnection, getRedisUrl } = require("../queues/config");
const { ACTIONS, FRESHNESS_SOURCES, buildFreshness, buildInvalidation, buildOperationalBlock } = require("./operational/contract");

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
const WORKER_HEARTBEAT_SOURCE = "sync_worker_heartbeat";

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

async function readLatestWorkerHeartbeat() {
  if (!operationalMetricSnapshots) return null;
  try {
    const [row] = await db
      .select()
      .from(operationalMetricSnapshots)
      .where(eq(operationalMetricSnapshots.source, WORKER_HEARTBEAT_SOURCE))
      .orderBy(desc(operationalMetricSnapshots.createdAt))
      .limit(1);
    return row || null;
  } catch (error) {
    return null;
  }
}

async function recordWorkerHeartbeat({ workerId = process.env.HOSTNAME || `worker-${process.pid}`, queues = [], status = "alive" } = {}) {
  const now = new Date();
  return persistOperationalSnapshot({
    bucket: "minute",
    bucketStartedAt: toMinuteBucket(now),
    source: WORKER_HEARTBEAT_SOURCE,
    metrics: { workerId, queues, status, heartbeatAt: now.toISOString(), pid: process.pid },
  });
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
  const heartbeat = await readLatestWorkerHeartbeat();
  const heartbeatAt = heartbeat?.metrics?.heartbeatAt || heartbeat?.createdAt?.toISOString?.() || null;
  const heartbeatStale = heartbeatAt
    ? Date.now() - new Date(heartbeatAt).getTime() > Number(process.env.SYNC_WORKER_HEARTBEAT_STALE_MS || 120000)
    : true;
  const worker = {
    heartbeatAt,
    heartbeatStale,
    workerHeartbeatState: heartbeatAt ? (heartbeatStale ? "worker_heartbeat_stale" : "alive") : "worker_offline",
    state: heartbeatAt ? (heartbeatStale ? "worker_heartbeat_stale" : "alive") : "worker_offline",
    source: heartbeat ? "postgres.operational_metric_snapshots" : fallback.worker.source,
  };

  if (!redisUrl) {
    return {
      ...fallback,
      readiness: "degraded",
      worker,
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
      readiness: worker.heartbeatStale ? "degraded" : "ready",
      worker,
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
  const counts = { queued: 0, running: 0, partialFailed: 0, failed: 0, retryable: 0, requiresHumanAction: 0, organizationsWithPendingDownstreamSync: 0 };
  for (const operation of operations) {
    const status = operation.status;
    if (QUEUED.has(status)) counts.queued += 1;
    if (RUNNING.has(status)) counts.running += 1;
    if (PARTIAL_FAILED.has(status)) counts.partialFailed += 1;
    if (FAILED.has(status)) counts.failed += 1;
    if (operation.retryable || operation.nextRetryAt || operation.lastErrorJson?.retryable) counts.retryable += 1;
    if (operation.requiresHumanAction || operation.lastErrorJson?.requiresHumanAction || operation.lastErrorJson?.hitl || operation.status === "hitl_required") counts.requiresHumanAction += 1;
  }
  const organizations = profiles.map(summarizeOrganization);
  counts.requiresHumanAction += steps.filter((step) => step.requiresHumanAction || step.lastErrorJson?.requiresHumanAction || step.lastErrorJson?.hitl).length;
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
  const operationalScanLimit = Math.min(Math.max(Number.parseInt(process.env.OWNER_OPERATIONAL_LOG_SCAN_LIMIT || "5000", 10), 100), 20000);
  const [profiles, operations, steps, technicalHealth] = await Promise.all([
    db.select().from(organizationProfiles),
    syncOperations ? db.select().from(syncOperations).orderBy(desc(syncOperations.updatedAt)).limit(operationalScanLimit).catch(() => []) : [],
    syncOperationSteps ? db.select().from(syncOperationSteps).orderBy(desc(syncOperationSteps.updatedAt)).limit(operationalScanLimit).catch(() => []) : [],
    loadWorkerHealthSnapshot(),
  ]);
  const summary = buildOperationsSummary({ profiles, operations, steps, technicalHealth });
  summary.source = { primary: "sync_operations+sync_operation_steps+organization_profiles", operationalScanLimit, drilldownBasePath: "/owner/logs" };
  return summary;
}

const secondsSince = (value, now = new Date()) => {
  const ms = value ? new Date(value).getTime() : 0;
  return ms ? Math.max(0, Math.floor((new Date(now).getTime() - ms) / 1000)) : null;
};
const normalizeOutput = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const isActiveOperationalStatus = (status) => ["queued", "running", "downstream_running", "processing", "active", "waiting", "delayed"].includes(String(status || ""));
const isProblemOperationalStatus = (status) => ["failed", "partial_failed", "error", "conflict", "hitl_required"].includes(String(status || ""));

function classifyWorkerHealthState(workerHealth = {}) {
  const heartbeatState = workerHealth.worker?.workerHeartbeatState || workerHealth.worker?.state;
  if (heartbeatState === "worker_offline" || (!workerHealth.worker?.heartbeatAt && workerHealth.worker?.heartbeatStale)) return "worker_offline";
  if (heartbeatState === "worker_heartbeat_stale" || workerHealth.worker?.heartbeatStale) return "worker_heartbeat_stale";
  return "alive";
}

function classifyQueueState(queue = {}, { workerState = "alive", previousQueue = null } = {}) {
  if (Number(queue.failed || 0) > 0) return "failed_jobs_present";
  if (workerState !== "alive" && (Number(queue.waiting || 0) > 0 || Number(queue.active || 0) > 0)) return "stuck_in_queue";
  if (Number(queue.oldestJobAgeSeconds || 0) >= 900) return "stuck_in_queue";
  if (Number(queue.waiting || 0) >= 10) return "backlog_growing";
  if (previousQueue && Number(queue.waiting || 0) > Number(previousQueue.waiting || 0) && Number(queue.oldestJobAgeSeconds || 0) > 120) return "backlog_growing";
  return "alive";
}

function blockForClassification({ classification, checkedAt, source = FRESHNESS_SOURCES.WORKER_RUNTIME, details = {}, humanMessage = null, providerCode = null, providerStatus = null, operationIds = [] } = {}) {
  const critical = ["worker_offline", "stuck_in_queue"].includes(classification);
  const warning = ["worker_heartbeat_stale", "backlog_growing", "failed_jobs_present"].includes(classification);
  const status = classification === "alive" ? "healthy" : classification;
  return buildOperationalBlock({
    status,
    severity: critical ? "critical" : warning ? "warning" : "success",
    humanMessage: humanMessage || (classification === "alive" ? "Worker y colas operativas al día." : "Se detectó una señal operacional que requiere revisión owner."),
    providerCode,
    providerStatus,
    nextAction: classification === "alive" ? ACTIONS.NONE : classification === "worker_heartbeat_stale" ? ACTIONS.VERIFY_PROVIDER : ACTIONS.HUMAN_ACTION_REQUIRED,
    freshness: buildFreshness({ source, checkedAt, staleAfterSeconds: source === FRESHNESS_SOURCES.WORKER_RUNTIME ? 30 : 300 }),
    invalidation: buildInvalidation({ invalidateOnOperationIds: operationIds }),
    details,
  });
}

function buildWorkerHealthBlock(workerHealth = {}, { generatedAt = new Date() } = {}) {
  const classification = classifyWorkerHealthState(workerHealth);
  const checkedAt = workerHealth.worker?.heartbeatAt || generatedAt;
  const block = blockForClassification({
    classification,
    checkedAt,
    humanMessage: classification === "alive" ? "Worker vivo con heartbeat fresco." : classification === "worker_offline" ? "No hay heartbeat persistido del worker; no se asume salud correcta." : "El heartbeat del worker está vencido.",
    providerCode: workerHealth.redis?.status || null,
    providerStatus: classification,
    details: { readiness: workerHealth.readiness || "unknown", heartbeatAt: workerHealth.worker?.heartbeatAt || null, redis: workerHealth.redis || null, source: workerHealth.worker?.source || null },
    source: workerHealth.worker?.source?.startsWith?.("postgres") ? FRESHNESS_SOURCES.WORKER_RUNTIME : FRESHNESS_SOURCES.LOCAL_RECONCILED,
  });
  return { classification, readiness: workerHealth.readiness || "unknown", heartbeat: { at: workerHealth.worker?.heartbeatAt || null, state: classification }, redis: workerHealth.redis || null, ...block };
}

function buildQueuesBlocks(queues = [], { workerState = "alive", generatedAt = new Date(), previousQueues = [] } = {}) {
  return queues.map((queue) => {
    const previousQueue = previousQueues.find((item) => item.name === queue.name);
    const classification = classifyQueueState(queue, { workerState, previousQueue });
    return { name: queue.name, waiting: Number(queue.waiting || 0), active: Number(queue.active || 0), delayed: Number(queue.delayed || 0), failed: Number(queue.failed || 0), oldestJobAgeSeconds: Number(queue.oldestJobAgeSeconds || 0), classification, ...blockForClassification({ classification, checkedAt: generatedAt, providerCode: queue.name, providerStatus: classification, details: { queueName: queue.name, previousWaiting: previousQueue?.waiting ?? null } }) };
  });
}

function latestStepByOperation(steps = []) {
  const map = new Map();
  for (const step of steps) {
    const previous = map.get(step.operationId);
    if (!previous || new Date(step.updatedAt || 0) > new Date(previous.updatedAt || 0)) map.set(step.operationId, step);
  }
  return map;
}

function serializeActiveOperation(operation, step, profile, workerState, now = new Date()) {
  const output = normalizeOutput(step?.outputJson);
  const error = normalizeOutput(step?.lastErrorJson || operation.lastErrorJson);
  const classification = workerState !== "alive" && isActiveOperationalStatus(operation.status) ? workerState : isProblemOperationalStatus(step?.status || operation.status) ? "failed_jobs_present" : "alive";
  const operationId = operation.id;
  const block = blockForClassification({ classification, checkedAt: step?.updatedAt || operation.updatedAt || now, providerCode: output.providerCode || error.code || null, providerStatus: output.providerStatus || error.status || step?.status || operation.status, details: { operationId, organizationId: operation.logtoOrganizationId || operation.entityId || null, retryable: Boolean(error.retryable || isProblemOperationalStatus(operation.status)) }, operationIds: [operationId], source: isActiveOperationalStatus(operation.status) ? FRESHNESS_SOURCES.WORKER_RUNTIME : FRESHNESS_SOURCES.LOCAL_RECONCILED, humanMessage: output.humanMessage || error.message || `Operación ${operation.operationType} en estado ${operation.status}.` });
  return { operationId, organizationId: operation.logtoOrganizationId || operation.entityId || null, organizationName: profile?.nameCache || null, operationType: operation.operationType, entityType: operation.entityType, stepName: step?.stepName || null, status: step?.status || operation.status, retryState: output.retryState || operation.status, queueName: step?.queueName || output.queueName || null, jobId: step?.jobId || output.jobId || null, jobAgeSeconds: secondsSince(step?.createdAt || operation.createdAt, now), workerHeartbeatState: workerState, ...block };
}

function buildBlockedOrganizations({ profiles = [], activeOperations = [], workerState = "alive", queueClassifications = [] } = {}) {
  const activeByOrg = new Map(activeOperations.map((op) => [op.organizationId, op]));
  const globalQueueBlocker = queueClassifications.find((queue) => ["stuck_in_queue", "backlog_growing", "failed_jobs_present"].includes(queue.classification));
  return profiles.map((profile) => {
    const op = activeByOrg.get(profile.logtoOrganizationId);
    const missingCompany = !profile.fluentcrmCompanyId || ["not_linked", "pending", "conflict", "error"].includes(profile.fluentcrmSyncStatus);
    const contactsNotStarted = op?.stepName && /contact/i.test(op.stepName) && ["queued", "waiting", "delayed"].includes(op.retryState);
    const workerBlock = workerState !== "alive" && op;
    const queueBlock = globalQueueBlocker && op;
    const blocker = workerBlock ? workerState : queueBlock ? globalQueueBlocker.classification : missingCompany ? "missing_company" : contactsNotStarted ? "contacts_not_started" : null;
    if (!blocker) return null;
    const block = blockForClassification({ classification: ["worker_offline", "worker_heartbeat_stale", "stuck_in_queue", "backlog_growing", "failed_jobs_present"].includes(blocker) ? blocker : "failed_jobs_present", checkedAt: profile.updatedAt || new Date(), providerCode: op?.providerCode || null, providerStatus: op?.providerStatus || profile.fluentcrmSyncStatus || null, operationIds: op ? [op.operationId] : [], source: op ? FRESHNESS_SOURCES.WORKER_RUNTIME : FRESHNESS_SOURCES.LOCAL_RECONCILED, humanMessage: blocker === "missing_company" ? "Falta crear o enlazar Company en FluentCRM según el contrato operacional." : blocker === "contacts_not_started" ? "La sincronización de contactos no inició o está pendiente." : op?.humanMessage });
    return { logtoOrganizationId: profile.logtoOrganizationId, name: profile.nameCache || null, blocker, references: { operationIds: op ? [op.operationId] : [], queueName: op?.queueName || globalQueueBlocker?.name || null }, ...block };
  }).filter(Boolean);
}

function buildTimeline({ operations = [], steps = [], auditLogRows = [], profiles = [], limit = 25 } = {}) {
  const profileByOrg = new Map(profiles.map((profile) => [profile.logtoOrganizationId, profile]));
  const opById = new Map(operations.map((operation) => [operation.id, operation]));
  const stepEvents = steps.map((step) => { const op = opById.get(step.operationId) || {}; const output = normalizeOutput(step.outputJson); const error = normalizeOutput(step.lastErrorJson); return { id: `step-${step.id}`, at: step.updatedAt?.toISOString?.() || step.updatedAt || step.createdAt, type: /provider_verification/i.test(step.stepName) ? "provider_verification" : /contact/i.test(step.stepName) ? "contacts_blocked" : /company/i.test(step.stepName) && ["failed", "error"].includes(step.status) ? "company_sync_failed" : step.status === "queued" ? "worker_taken" : "operational_step", organizationId: op.logtoOrganizationId || null, organizationName: profileByOrg.get(op.logtoOrganizationId)?.nameCache || null, operationId: step.operationId, stepName: step.stepName, status: step.status, providerCode: output.providerCode || error.code || null, providerStatus: output.providerStatus || error.status || step.status, humanMessage: output.humanMessage || error.message || `${step.stepName} ${step.status}` }; });
  const auditEvents = auditLogRows.map((log) => ({ id: `audit-${log.id}`, at: log.createdAt?.toISOString?.() || log.createdAt, type: /retry/i.test(log.action) ? "retry_requested" : log.result === "error" ? "manual_action_required" : "audit_event", organizationId: log.organizationId || null, organizationName: profileByOrg.get(log.organizationId)?.nameCache || null, operationId: log.metadata?.syncOperationId || log.metadata?.operationId || null, stepName: log.metadata?.stepName || null, status: log.result, providerCode: log.metadata?.providerCode || null, providerStatus: log.metadata?.providerStatus || null, humanMessage: safeMessage(log.metadata?.humanMessage || log.metadata?.message || log.action, "Evento operacional registrado.") }));
  return [...stepEvents, ...auditEvents].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0)).slice(0, limit);
}

function buildWorkerQueuesObservabilityAggregate({ workerHealth = {}, operations = [], steps = [], profiles = [], auditLogRows = [], generatedAt = new Date(), previousQueues = [] } = {}) {
  const workerHealthBlock = buildWorkerHealthBlock(workerHealth, { generatedAt });
  const queues = buildQueuesBlocks(workerHealth.queues || [], { workerState: workerHealthBlock.classification, generatedAt, previousQueues });
  const stepByOp = latestStepByOperation(steps);
  const profileByOrg = new Map(profiles.map((profile) => [profile.logtoOrganizationId, profile]));
  const activeOperations = operations.filter((operation) => isActiveOperationalStatus(operation.status) || isProblemOperationalStatus(operation.status) || isProblemOperationalStatus(stepByOp.get(operation.id)?.status)).map((operation) => serializeActiveOperation(operation, stepByOp.get(operation.id), profileByOrg.get(operation.logtoOrganizationId), workerHealthBlock.classification, generatedAt));
  const blockedOrganizations = buildBlockedOrganizations({ profiles, activeOperations, workerState: workerHealthBlock.classification, queueClassifications: queues });
  const timeline = buildTimeline({ operations, steps, auditLogRows, profiles });
  return { contractVersion: "2026-06-issue-177-phase-3-worker-queues", generatedAt: generatedAt.toISOString(), source: { backbone: "operational/contract", primary: "worker_runtime+sync_operations+sync_operation_steps+organization_profiles+audit_logs", dominance: "worker_runtime_over_local_reconciled_over_persisted_snapshot" }, workerHealth: workerHealthBlock, queues, activeOperations, blockedOrganizations, timeline };
}

async function loadWorkerQueuesObservability() {
  const operationalScanLimit = Math.min(Math.max(Number.parseInt(process.env.OWNER_OPERATIONAL_LOG_SCAN_LIMIT || "5000", 10), 100), 20000);
  const [profiles, operations, steps, auditLogRows, workerHealth] = await Promise.all([
    db.select().from(organizationProfiles).catch(() => []),
    syncOperations ? db.select().from(syncOperations).orderBy(desc(syncOperations.updatedAt)).limit(operationalScanLimit).catch(() => []) : [],
    syncOperationSteps ? db.select().from(syncOperationSteps).orderBy(desc(syncOperationSteps.updatedAt)).limit(operationalScanLimit).catch(() => []) : [],
    auditLogs ? db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100).catch(() => []) : [],
    loadWorkerHealthSnapshot().catch((error) => ({ ...buildFallbackWorkerHealthSnapshot(), readiness: "degraded", worker: { heartbeatStale: true, workerHeartbeatState: "worker_offline", source: "degraded_loader" }, redis: { status: "error", message: safeMessage(error), source: "degraded_loader" } })),
  ]);
  return buildWorkerQueuesObservabilityAggregate({ workerHealth, operations, steps, profiles, auditLogRows, generatedAt: new Date() });
}


void refreshWorkerHealthSnapshot().catch(() => null);

module.exports = {
  buildOperationsSummary,
  buildWorkerQueuesObservabilityAggregate,
  buildWorkerHealthBlock,
  buildQueuesBlocks,
  classifyQueueState,
  classifyWorkerHealthState,
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
  loadWorkerQueuesObservability,
  parseRedisInfo,
  loadWorkerHealthSnapshot,
  recordWorkerHeartbeat,
  summarizeOrganization,
};
