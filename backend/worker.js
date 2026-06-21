require("dotenv").config();
<<<<<<< HEAD
const { asc, inArray } = require("drizzle-orm");
const { db } = require("./db/client");
const { syncOperations } = require("./db/schema");
const { QUEUE_NAME, getRedisConnectionOptions } = require("./services/syncQueue");
const { processSyncOperation } = require("./services/syncOperationProcessors");

const POLL_INTERVAL_MS = Number.parseInt(process.env.CIVITAS_SYNC_WORKER_POLL_INTERVAL_MS || "5000", 10);
const BATCH_SIZE = Number.parseInt(process.env.CIVITAS_SYNC_WORKER_BATCH_SIZE || "10", 10);

async function pollQueuedOperations() {
  const now = new Date();
  const rows = await db.select().from(syncOperations)
    .where(inArray(syncOperations.status, ["queued", "pending"]))
    .orderBy(asc(syncOperations.createdAt))
    .limit(BATCH_SIZE);
  for (const operation of rows.filter((row) => !row.nextRetryAt || row.nextRetryAt <= now)) {
    await processSyncOperation(operation);
  }
  return rows.length;
}

function startPollingWorker() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await pollQueuedOperations(); } catch (error) { console.error("Civitas sync polling worker failed", error); } finally { running = false; }
  };
  const interval = setInterval(tick, Number.isInteger(POLL_INTERVAL_MS) && POLL_INTERVAL_MS > 0 ? POLL_INTERVAL_MS : 5000);
  void tick();
  return { close: () => clearInterval(interval) };
}

function startBullMqWorker() {
  const options = getRedisConnectionOptions();
  if (!options) return null;
  const { Worker } = require("bullmq");
  const worker = new Worker(QUEUE_NAME, async (job) => processSyncOperation(job.data.operationId), options);
  worker.on("failed", (job, error) => console.error("Civitas sync BullMQ job failed", { jobId: job?.id, error }));
  worker.on("completed", (job) => console.log("Civitas sync BullMQ job completed", { jobId: job.id }));
  return worker;
}

function startWorker() {
  const bull = startBullMqWorker();
  const polling = startPollingWorker();
  console.log("Civitas sync worker started", { queue: bull ? QUEUE_NAME : "polling-only", pollIntervalMs: POLL_INTERVAL_MS });
  return { bull, polling, close: async () => { polling.close(); if (bull) await bull.close(); } };
}

if (require.main === module) startWorker();
module.exports = { pollQueuedOperations, startBullMqWorker, startPollingWorker, startWorker };
=======
const { Worker } = require("bullmq");
const { QUEUE_NAMES, createRedisConnection, getBullMqPrefix, getRedisUrl } = require("./queues/config");
const { processOrganizationBootstrapJob } = require("./services/organizationBootstrapOrchestrator");

function createWorkers(connection = createRedisConnection()) {
  const concurrency = Number.parseInt(process.env.ORGANIZATION_BOOTSTRAP_WORKER_CONCURRENCY || process.env.WORKER_CONCURRENCY || "2", 10);
  const worker = new Worker(QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, processOrganizationBootstrapJob, { connection, prefix: getBullMqPrefix(), concurrency: Number.isInteger(concurrency) && concurrency > 0 ? concurrency : 2 });
  worker.on("completed", (job, result) => console.log(JSON.stringify({ component: "worker", queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, jobId: job.id, operationId: job.data?.operationId, status: "completed", result })));
  worker.on("failed", (job, error) => console.error(JSON.stringify({ component: "worker", queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, jobId: job?.id, operationId: job?.data?.operationId, status: "failed", error: error.message, attemptsMade: job?.attemptsMade })));
  worker.on("error", (error) => console.error(JSON.stringify({ component: "worker", queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, status: "error", error: error.message })));
  return [worker];
}

async function main() {
  try {
    const redisUrl = getRedisUrl();
    const workers = createWorkers();
    console.log(JSON.stringify({ component: "worker", status: "started", redisUrl, bullmqPrefix: getBullMqPrefix(), queues: Object.values(QUEUE_NAMES) }));
    const shutdown = async (signal) => {
      console.log(JSON.stringify({ component: "worker", status: "shutdown", signal }));
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
module.exports = { createWorkers };
>>>>>>> origin/main
