require("dotenv").config();

const { Worker } = require("bullmq");
const { and, asc, eq } = require("drizzle-orm");
const { db } = require("./db/client");
const { syncOperations } = require("./db/schema");
const { QUEUE_NAMES, createRedisConnection, getBullMqPrefix, getRedisUrl } = require("./queues/config");
const { QUEUE_NAME: SYNC_QUEUE_NAME } = require("./services/syncQueue");
const { processSyncOperation } = require("./services/syncOperationProcessors");
const { processOrganizationBootstrapJob } = require("./services/organizationBootstrapOrchestrator");
const { loadOwnerSystemMetrics, recordWorkerHeartbeat } = require("./services/operationalObservability");
const { OPERATION_STATUSES } = require("./services/syncOperations");

function createWorkers(connection = createRedisConnection()) {
  const concurrency = Number.parseInt(process.env.ORGANIZATION_BOOTSTRAP_WORKER_CONCURRENCY || process.env.WORKER_CONCURRENCY || "2", 10);
  const bootstrapWorker = new Worker(QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, processOrganizationBootstrapJob, {
    connection,
    prefix: getBullMqPrefix(),
    concurrency: Number.isInteger(concurrency) && concurrency > 0 ? concurrency : 2,
  });
  const syncWorker = new Worker(SYNC_QUEUE_NAME, async (job) => processSyncOperation(job.data?.operationId), {
    connection,
    prefix: getBullMqPrefix(),
    concurrency: Number.isInteger(concurrency) && concurrency > 0 ? concurrency : 2,
  });

  for (const worker of [bootstrapWorker, syncWorker]) {
    const queueName = worker.name;
    worker.on("completed", (job, result) =>
      console.log(JSON.stringify({ component: "worker", queueName, jobId: job.id, operationId: job.data?.operationId, status: "completed", result }))
    );
    worker.on("failed", (job, error) =>
      console.error(JSON.stringify({ component: "worker", queueName, jobId: job?.id, operationId: job?.data?.operationId, status: "failed", error: error.message, attemptsMade: job?.attemptsMade }))
    );
    worker.on("error", (error) =>
      console.error(JSON.stringify({ component: "worker", queueName, status: "error", error: error.message }))
    );
  }

  return [bootstrapWorker, syncWorker];
}

async function processQueuedSyncOperationsBatch({ limit = Number.parseInt(process.env.SYNC_OPERATION_DB_POLL_BATCH_SIZE || "5", 10) || 5 } = {}) {
  const queued = await db
    .select()
    .from(syncOperations)
    .where(eq(syncOperations.status, OPERATION_STATUSES.QUEUED))
    .orderBy(asc(syncOperations.createdAt))
    .limit(limit);
  for (const operation of queued) {
    const [claimed] = await db
      .update(syncOperations)
      .set({ status: OPERATION_STATUSES.RUNNING, startedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(syncOperations.id, operation.id), eq(syncOperations.status, OPERATION_STATUSES.QUEUED)))
      .returning();
    if (!claimed) continue;
    console.log(JSON.stringify({ component: "worker", queueName: SYNC_QUEUE_NAME, operationId: operation.id, operationType: operation.operationType, status: "taken_by_worker", transport: "db_polling" }));
    await processSyncOperation(claimed);
  }
  return queued.length;
}

function startSyncOperationDbPoller() {
  const intervalMs = Number.parseInt(process.env.SYNC_OPERATION_DB_POLL_INTERVAL_MS || "5000", 10);
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) return null;
  let running = false;
  const poll = async () => {
    if (running) return;
    running = true;
    try {
      await processQueuedSyncOperationsBatch();
    } catch (error) {
      console.error(JSON.stringify({ component: "worker", queueName: SYNC_QUEUE_NAME, status: "db_poll_failed", error: error.message }));
    } finally {
      running = false;
    }
  };
  void poll();
  return setInterval(poll, intervalMs);
}

function startWorkerHeartbeat({ queues = [] } = {}) {
  const intervalMs = Number.parseInt(process.env.SYNC_WORKER_HEARTBEAT_INTERVAL_MS || "30000", 10);
  const beat = () => recordWorkerHeartbeat({ queues, status: "alive" }).catch((error) => console.warn(JSON.stringify({ component: "worker", status: "heartbeat_skipped", error: error.message })));
  void beat();
  return setInterval(beat, intervalMs);
}

function startOperationalMetricsSampler() {
  const intervalMs = Number.parseInt(process.env.OPERATIONAL_METRICS_SAMPLE_INTERVAL_MS || "60000", 10);
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) return null;
  const sample = () => loadOwnerSystemMetrics().catch((error) => console.warn(JSON.stringify({ component: "worker", status: "operational_metrics_sample_skipped", error: error.message })));
  void sample();
  return setInterval(sample, intervalMs);
}

async function main() {
  try {
    const redisUrl = getRedisUrl({ required: false });
    const workers = redisUrl ? createWorkers() : [];
    const dbPoller = startSyncOperationDbPoller();
    const heartbeat = startWorkerHeartbeat({ queues: [...new Set([...Object.values(QUEUE_NAMES), SYNC_QUEUE_NAME])] });
    const metricsSampler = startOperationalMetricsSampler();
    console.log(JSON.stringify({ component: "worker", status: "started", redisUrlConfigured: Boolean(redisUrl), bullmqPrefix: getBullMqPrefix(), queues: [...new Set([...Object.values(QUEUE_NAMES), SYNC_QUEUE_NAME])], dbPolling: Boolean(dbPoller), operationalMetricsSampler: Boolean(metricsSampler) }));

    const shutdown = async (signal) => {
      console.log(JSON.stringify({ component: "worker", status: "shutdown", signal }));
      if (metricsSampler) clearInterval(metricsSampler);
      if (dbPoller) clearInterval(dbPoller);
      if (heartbeat) clearInterval(heartbeat);
      await Promise.all(workers.map((worker) => worker.close()));
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    console.error(JSON.stringify({ component: "worker", status: "startup_failed", error: error.message }));
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { createWorkers, processQueuedSyncOperationsBatch, startOperationalMetricsSampler, startSyncOperationDbPoller, startWorkerHeartbeat };
