const { desc } = require("drizzle-orm");
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

async function readRecentOperationalSnapshots(limit = 2) {
  if (!operationalMetricSnapshots) return [];
  try {
    return await db.select().from(operationalMetricSnapshots).orderBy(desc(operationalMetricSnapshots.bucketStartedAt)).limit(limit);
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
  const started = Date.now();
  const ping = await connection.ping();
  const pingLatencyMs = Date.now() - started;
  const [statsRaw, memoryRaw] = await Promise.all([
    connection.info("stats").catch((error) => ({ error })),
    connection.info("memory").catch((error) => ({ error })),
  ]);
  const stats = typeof statsRaw === "string" ? parseRedisInfo(statsRaw) : null;
  const memory = typeof memoryRaw === "string" ? parseRedisInfo(memoryRaw) : null;
  return {
    updatedAt,
    ping: { status: ping === "PONG" ? "live" : "not_instrumented", latencyMs: pingLatencyMs },
    stats,
    memory,
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

function buildMetricsResponse({ redis, bullmq, previousSnapshot, persisted }) {
  const updatedAt = redis?.updatedAt || new Date().toISOString();
  const hitMiss = deriveHitMissRatio(redis?.stats || {});
  const commandThroughput = deriveDeltaPerMinute(redis?.stats?.total_commands_processed, previousSnapshot, ["redis", "stats", "total_commands_processed"]);
  const jobThroughput = deriveDeltaPerMinute(bullmq?.totals?.completed, previousSnapshot, ["bullmq", "totals", "completed"]);
  const failedJobs = bullmq?.totals?.failed ?? null;
  const retryCount = bullmq?.totals?.retryCount ?? null;
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
      avg: metric({ instrumentationStatus: "not_instrumented", unit: "ms", source: "redis.command_sampler", updatedAt, note: "No hay muestreo de latencia por comando en esta iteración." }),
      p95: metric({ instrumentationStatus: "not_instrumented", unit: "ms", source: "redis.command_sampler", updatedAt, note: "Requiere histogramas o slowlog muestreado." }),
      p99: metric({ instrumentationStatus: "not_instrumented", unit: "ms", source: "redis.command_sampler", updatedAt, note: "Requiere histogramas o slowlog muestreado." }),
    },
    bytesAndSerialization: {
      avgKeySize: metric({ instrumentationStatus: "not_instrumented", unit: "bytes", source: "civitas.serialization", updatedAt, note: "Requiere instrumentar serialización/tamaño de payload por key." }),
      rawVsCompressed: metric({ instrumentationStatus: "not_instrumented", unit: "ratio", source: "civitas.serialization", updatedAt, note: "No existe medición raw/compressed en la capa de serialización." }),
      compressionRatio: metric({ instrumentationStatus: "not_instrumented", unit: "ratio", source: "civitas.serialization", updatedAt, note: "Propuesto para siguiente iteración." }),
    },
    callsAndThroughput: {
      redisCommandsProcessed: metric({ value: redis?.stats?.total_commands_processed ?? null, unit: "count", instrumentationStatus: redis?.stats ? "live" : "not_instrumented", source: "redis.info.stats.total_commands_processed", updatedAt, note: redis?.errors?.stats }),
      redisCommandsPerMinute: metric({ value: commandThroughput, unit: "ops/min", instrumentationStatus: commandThroughput === null ? "sampled" : "derived", source: "postgres.operational_metric_snapshots.delta(redis.info.stats.total_commands_processed)", updatedAt, note: commandThroughput === null ? "Se requiere al menos un snapshot previo para derivar throughput por ventana." : null }),
      bullmqJobsPerMinute: metric({ value: jobThroughput, unit: "jobs/min", instrumentationStatus: jobThroughput === null ? "sampled" : "derived", source: "postgres.operational_metric_snapshots.delta(bullmq.completed)", updatedAt, note: jobThroughput === null ? "Se requiere al menos un snapshot previo para derivar throughput por ventana." : null }),
      totalBullmqCompleted: metric({ value: bullmq?.totals?.completed ?? null, unit: "jobs", instrumentationStatus: bullmq ? "live" : "not_instrumented", source: "bullmq.getJobCounts.completed", updatedAt }),
    },
    debugAndLogging: {
      redisOps: metric({ value: redis?.stats?.total_commands_processed ?? null, unit: "count", instrumentationStatus: redis?.stats ? "live" : "not_instrumented", source: "redis.info.stats", updatedAt }),
      bullmqJobs: metric({ value: bullmq?.totals?.completed ?? null, unit: "jobs", instrumentationStatus: bullmq ? "live" : "not_instrumented", source: "bullmq.getJobCounts", updatedAt }),
      failedJobs: metric({ value: failedJobs, unit: "jobs", instrumentationStatus: bullmq ? "live" : "not_instrumented", source: "bullmq.getJobCounts.failed", updatedAt }),
      retryRate: metric({ value: retryCount, unit: "attempts", instrumentationStatus: bullmq ? "sampled" : "not_instrumented", source: "bullmq.recent_jobs.attemptsMade", window: "last 100 completed/failed jobs", updatedAt, note: "Agregado de attemptsMade sobre jobs recientes retenidos por BullMQ." }),
      slowQueries: metric({ instrumentationStatus: "not_instrumented", unit: "count", source: "redis.slowlog", updatedAt, note: "No se consulta SLOWLOG todavía para evitar overhead y exposición accidental." }),
    },
    expansion: {
      redisMemory: {
        usedMemory: metric({ value: usedMemoryMb, unit: "MB", instrumentationStatus: usedMemoryMb === null ? "not_instrumented" : "live", source: "redis.info.memory.used_memory", updatedAt, note: redis?.errors?.memory }),
        usedMemoryPeak: metric({ value: usedMemoryPeakMb, unit: "MB", instrumentationStatus: usedMemoryPeakMb === null ? "not_instrumented" : "live", source: "redis.info.memory.used_memory_peak", updatedAt, note: redis?.errors?.memory }),
        evictedKeys: metric({ value: redis?.stats?.evicted_keys ?? null, unit: "keys", instrumentationStatus: redis?.stats ? "live" : "not_instrumented", source: "redis.info.stats.evicted_keys", updatedAt }),
        expiredKeys: metric({ value: redis?.stats?.expired_keys ?? null, unit: "keys", instrumentationStatus: redis?.stats ? "live" : "not_instrumented", source: "redis.info.stats.expired_keys", updatedAt }),
      },
      ttlDistribution: metric({ instrumentationStatus: "not_instrumented", source: "redis.scan.ttl", updatedAt, note: "Requiere muestreo SCAN/TTL controlado por namespace." }),
      retryRate: metric({ value: retryCount, unit: "attempts", instrumentationStatus: bullmq ? "sampled" : "not_instrumented", source: "bullmq.recent_jobs.attemptsMade", updatedAt }),
      throughput24h: metric({ instrumentationStatus: "proposed", unit: "ops/hour", source: "postgres.operational_metric_snapshots.hour", window: "24h", updatedAt, note: "La tabla permite buckets horarios; falta job de rollup/retención." }),
      perOrganization: metric({ instrumentationStatus: "not_instrumented", source: "logto_organization_id_attribution", updatedAt, note: "No hay atribución confiable por logto_organization_id para operaciones Redis/cache." }),
      alerts: metric({ instrumentationStatus: "proposed", source: "civitas.alert_rules", updatedAt, note: "Umbrales propuestos: miss > 20%, p99 > 10ms, failed jobs > 0." }),
    },
    raw: {
      redis: { stats: redis?.stats || null, memory: redis?.memory || null },
      bullmq,
    },
  };
}

async function loadOwnerSystemMetrics() {
  const redisUrl = getRedisUrl({ required: false });
  const updatedAt = new Date();
  const previousSnapshots = await readRecentOperationalSnapshots(1);

  if (!redisUrl) {
    const response = buildMetricsResponse({ redis: { updatedAt: updatedAt.toISOString(), errors: { stats: "REDIS_URL no configurado.", memory: "REDIS_URL no configurado." } }, bullmq: null, previousSnapshot: previousSnapshots[0], persisted: null });
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
        redis: { stats: redis.stats || {}, memory: redis.memory || {}, pingLatencyMs: redis.ping.latencyMs },
        bullmq,
      },
    };
    const persisted = await persistOperationalSnapshot(snapshot);
    const response = buildMetricsResponse({ redis, bullmq, previousSnapshot: previousSnapshots[0], persisted });
    response.status = "ok";
    return response;
  } catch (error) {
    const response = buildMetricsResponse({ redis: { updatedAt: updatedAt.toISOString(), errors: { stats: safeMessage(error), memory: safeMessage(error) } }, bullmq: null, previousSnapshot: previousSnapshots[0], persisted: null });
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
    syncOperations ? db.select().from(syncOperations).orderBy(desc(syncOperations.updatedAt)).limit(100).catch(() => []) : [],
    syncOperationSteps ? db.select().from(syncOperationSteps).orderBy(desc(syncOperationSteps.updatedAt)).limit(100).catch(() => []) : [],
    loadWorkerHealthSnapshot(),
  ]);
  return buildOperationsSummary({ profiles, operations, steps, technicalHealth });
}

void refreshWorkerHealthSnapshot().catch(() => null);

module.exports = {
  buildOperationsSummary,
  classifyTechnicalHealth,
  getWorkerHealthSnapshot,
  buildMetricsResponse,
  deriveHitMissRatio,
  loadOperationsSummary,
  loadOwnerSystemMetrics,
  parseRedisInfo,
  loadWorkerHealthSnapshot,
  summarizeOrganization,
};