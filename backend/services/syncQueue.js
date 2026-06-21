const QUEUE_NAME = process.env.CIVITAS_SYNC_QUEUE_NAME || "civitas-sync-operations";
const REDIS_URL = process.env.REDIS_URL || process.env.BULLMQ_REDIS_URL || null;
let queue = null;

function getRedisConnectionOptions() {
  if (!REDIS_URL) return null;
  return { connection: { url: REDIS_URL, maxRetriesPerRequest: null } };
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
  if (!syncQueue || !operation?.id) return { enqueued: false, reason: "redis_not_configured" };
  await syncQueue.add(operation.operationType || "sync_operation", { operationId: operation.id }, { jobId: `sync-operation-${operation.id}`, attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
  return { enqueued: true, queueName: QUEUE_NAME };
}

module.exports = { QUEUE_NAME, enqueueSyncOperation, getRedisConnectionOptions, getSyncQueue };
