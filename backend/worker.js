require("dotenv").config();

const { Worker } = require("bullmq");
const { QUEUE_NAMES, createRedisConnection, getBullMqPrefix, getRedisUrl } = require("./queues/config");
const { processOrganizationBootstrapJob } = require("./services/organizationBootstrapOrchestrator");
const { loadOwnerSystemMetrics } = require("./services/operationalObservability");

function createWorkers(connection = createRedisConnection()) {
  const concurrency = Number.parseInt(process.env.ORGANIZATION_BOOTSTRAP_WORKER_CONCURRENCY || process.env.WORKER_CONCURRENCY || "2", 10);
  const worker = new Worker(QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, processOrganizationBootstrapJob, {
    connection,
    prefix: getBullMqPrefix(),
    concurrency: Number.isInteger(concurrency) && concurrency > 0 ? concurrency : 2,
  });

  worker.on("completed", (job, result) =>
    console.log(JSON.stringify({ component: "worker", queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, jobId: job.id, operationId: job.data?.operationId, status: "completed", result }))
  );
  worker.on("failed", (job, error) =>
    console.error(JSON.stringify({ component: "worker", queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, jobId: job?.id, operationId: job?.data?.operationId, status: "failed", error: error.message, attemptsMade: job?.attemptsMade }))
  );
  worker.on("error", (error) =>
    console.error(JSON.stringify({ component: "worker", queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, status: "error", error: error.message }))
  );

  return [worker];
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
    const redisUrl = getRedisUrl();
    const workers = createWorkers();
    const metricsSampler = startOperationalMetricsSampler();
    console.log(JSON.stringify({ component: "worker", status: "started", redisUrlConfigured: Boolean(redisUrl), bullmqPrefix: getBullMqPrefix(), queues: Object.values(QUEUE_NAMES), operationalMetricsSampler: Boolean(metricsSampler) }));

    const shutdown = async (signal) => {
      console.log(JSON.stringify({ component: "worker", status: "shutdown", signal }));
      if (metricsSampler) clearInterval(metricsSampler);
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

module.exports = { createWorkers, startOperationalMetricsSampler };
