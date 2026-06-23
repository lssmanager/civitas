const { desc } = require("drizzle-orm");
const { db } = require("../db/client");
const { organizationProfiles, syncOperations, syncOperationSteps } = require("../db/schema");
const { QUEUE_NAMES, createQueue, createRedisConnection, getRedisUrl } = require("../queues/config");

const TERMINAL_OK = new Set(["completed", "succeeded", "success"]);
const RUNNING = new Set(["running", "processing", "active"]);
const QUEUED = new Set(["queued", "pending", "waiting", "delayed"]);
const PARTIAL_FAILED = new Set(["partial_failed"]);
const FAILED = new Set(["failed", "error"]);
const DOWNSTREAM_PENDING = new Set(["not_linked", "pending", "conflict", "error"]);
const CANONICAL_OK = new Set(["bootstrapped", "synced", "reconciled"]);
const QUEUE_JOB_TYPES = Object.freeze(["wait", "active", "delayed", "failed"]);

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

async function getWorkerHealthSnapshot() {
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

async function loadOperationsSummary() {
  const [profiles, operations, steps, technicalHealth] = await Promise.all([
    db.select().from(organizationProfiles),
    syncOperations ? db.select().from(syncOperations).orderBy(desc(syncOperations.updatedAt)).limit(100).catch(() => []) : [],
    syncOperationSteps ? db.select().from(syncOperationSteps).orderBy(desc(syncOperationSteps.updatedAt)).limit(100).catch(() => []) : [],
    getWorkerHealthSnapshot(),
  ]);
  return buildOperationsSummary({ profiles, operations, steps, technicalHealth });
}

module.exports = {
  buildOperationsSummary,
  classifyTechnicalHealth,
  getWorkerHealthSnapshot,
  loadOperationsSummary,
  summarizeOrganization,
};