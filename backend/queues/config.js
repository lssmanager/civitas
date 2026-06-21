const { Queue } = require("bullmq");
const IORedis = require("ioredis");

const QUEUE_NAMES = Object.freeze({ ORGANIZATION_BOOTSTRAP: "organization.bootstrap" });
function getRedisUrl({ required = true } = {}) {
  const url = process.env.REDIS_URL;
  if (!url && required) throw new Error("REDIS_URL is required for BullMQ/Redis orchestration (example: redis://redis:6379)");
  return url || null;
}
function createRedisConnection() {
  const url = getRedisUrl();
  return new IORedis(url, { maxRetriesPerRequest: null });
}
function getBullMqPrefix() { return process.env.BULLMQ_PREFIX || "civitas"; }
const defaultJobOptions = { attempts: Number(process.env.BULLMQ_ATTEMPTS || 3), backoff: { type: "exponential", delay: Number(process.env.BULLMQ_BACKOFF_MS || 5000) }, removeOnComplete: 1000, removeOnFail: 5000 };
function createQueue(name, connection = createRedisConnection()) { return new Queue(name, { connection, prefix: getBullMqPrefix(), defaultJobOptions }); }
module.exports = { QUEUE_NAMES, createQueue, createRedisConnection, defaultJobOptions, getBullMqPrefix, getRedisUrl };
