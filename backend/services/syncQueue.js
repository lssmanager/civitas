const { QUEUE_NAMES } = require("../queues/config");

const QUEUE_NAME = QUEUE_NAMES.SYNC_OPERATIONS;
const REDIS_URL = process.env.REDIS_URL || process.env.BULLMQ_REDIS_URL || null;
let queue = null;

function getRedisConnectionOptions() {
  if (!REDIS_URL) return null;
  return { connection: { url: REDIS_URL, maxRetriesPerRequest: null } };
}

function getSyncJobId(operation) {
  return operation?.id ? `sync-operation-${operation.id}` : null;
}

function getSyncQueue() {
  const options = getRedisConnectionOptions();
  if (!options) return null;
  if (!queue) {
    const { Queue } = require("bullmq");
    queue = new Queue(QUEUE_NAME, options);
  }
  return queue;
}

async function enqueueSyncOperation(operation) {
  const syncQueue = getSyncQueue();
  const jobId = getSyncJobId(operation);
  const enqueuedAt = new Date().toISOString();
  if (!syncQueue || !operation?.id || !jobId) return { enqueued: false, reason: "redis_not_configured", queueName: QUEUE_NAME, jobId, enqueuedAt };
  await syncQueue.add(operation.operationType || "sync_operation", { operationId: operation.id }, { jobId, attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
  return { enqueued: true, queueName: QUEUE_NAME, jobId, enqueuedAt };
}

async function getSyncJobSnapshot(operation) {
  const syncQueue = getSyncQueue();
  const jobId = getSyncJobId(operation);
  const fallbackTimestamp = operation?.createdAt ? new Date(operation.createdAt).getTime() : null;
  const fallbackAge = Number.isFinite(fallbackTimestamp) ? Math.max(0, Math.floor((Date.now() - fallbackTimestamp) / 1000)) : null;
  if (!syncQueue || !jobId) return { queueName: QUEUE_NAME, jobId, retryState: operation?.status || "unknown", enqueuedAt: operation?.createdAt || null, lastAttemptAt: null, jobAgeSeconds: fallbackAge, transport: "db_poll_fallback" };
  const job = await syncQueue.getJob(jobId);
  if (!job) return { queueName: QUEUE_NAME, jobId, retryState: operation?.status || "missing", enqueuedAt: operation?.createdAt || null, lastAttemptAt: null, jobAgeSeconds: fallbackAge, transport: "db_only_or_completed_removed" };
  const state = await job.getState().catch(() => operation?.status || "unknown");
  return {
    queueName: QUEUE_NAME,
    jobId,
    retryState: state,
    transport: "bullmq",
    enqueuedAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
    lastAttemptAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
    jobAgeSeconds: job.timestamp ? Math.max(0, Math.floor((Date.now() - Number(job.timestamp)) / 1000)) : null,
  };
}

module.exports = { QUEUE_NAME, enqueueSyncOperation, getRedisConnectionOptions, getSyncJobId, getSyncJobSnapshot, getSyncQueue };
