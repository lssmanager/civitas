const { QUEUE_NAMES } = require("../queues/config");
const { OPERATION_STATUSES, STEP_STATUSES, getSyncOperationWithSteps, recordOperationStep, updateSyncOperation } = require("../services/syncOperations");

const FOUNDATION_STEP_NAME = "foundation_worker_received";

async function processOrganizationBootstrapFoundationJob(job) {
  const operationId = job.data?.operationId || null;
  const attempt = job.attemptsMade + 1;
  console.log(JSON.stringify({ component: "organizationBootstrapFoundationWorker", queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, jobId: job.id, operationId, attempt, status: "received" }));

  if (!operationId) {
    return { status: "received_without_operation", note: "Foundation worker is running; product bootstrap orchestration is intentionally deferred to #107." };
  }

  const operation = await getSyncOperationWithSteps(operationId);
  if (!operation) throw new Error(`sync operation ${operationId} not found`);

  await updateSyncOperation({ id: operationId, status: OPERATION_STATUSES.RUNNING, retryCount: attempt - 1, startedAt: operation.startedAt || new Date() });
  await recordOperationStep({ operationId, stepName: FOUNDATION_STEP_NAME, queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, jobId: job.id, attempt, status: STEP_STATUSES.COMPLETED, outputJson: { scope: "foundation-106", nextIssue: "107", message: "Worker runtime accepted the job. Full owner bootstrap orchestration is intentionally not enabled in #106." } });
  await updateSyncOperation({ id: operationId, status: OPERATION_STATUSES.QUEUED, resultSnapshotJson: { foundationWorker: { received: true, nextIssue: "107" } } });

  return { status: "foundation_received", operationId };
}

module.exports = { FOUNDATION_STEP_NAME, processOrganizationBootstrapFoundationJob };
