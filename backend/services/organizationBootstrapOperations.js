const { desc, eq, inArray } = require("drizzle-orm");
const { db } = require("../db/client");
const { organizationBootstrapMicroRequests, organizationBootstrapOperations } = require("../db/schema");

const BOOTSTRAP_OPERATION_STATUSES = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  PARTIAL: "partial",
  FAILED: "failed",
});

const MICRO_REQUEST_STATUSES = Object.freeze({
  PENDING: "pending",
  QUEUED: "queued",
  IN_PROGRESS: "in_progress",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CONFLICT: "conflict",
  CANCELLED: "cancelled",
});

const OPEN_MICRO_REQUEST_STATUSES = [
  MICRO_REQUEST_STATUSES.PENDING,
  MICRO_REQUEST_STATUSES.QUEUED,
  MICRO_REQUEST_STATUSES.FAILED,
  MICRO_REQUEST_STATUSES.CONFLICT,
];

const safeJson = (value) => (value === undefined ? null : value);
const getContactTargetId = (contact = {}) => contact.logtoUserId || contact.email || contact.key || null;

function buildMicroRequestsForFluentCrmStep({ parentOperationId, logtoOrganizationId = null, fluentCrmStep = {}, payloadSnapshot = null } = {}) {
  if (!parentOperationId || !fluentCrmStep || fluentCrmStep.status === "not_requested") return [];
  const requests = [];
  const base = {
    parentOperationId,
    logtoOrganizationId,
    sourceStep: "fluentcrm",
  };

  if (fluentCrmStep.status === "conflict") {
    requests.push({
      ...base,
      microRequestType: "resolve.conflict.crm.company",
      targetEntityType: "crm_company",
      targetEntityId: fluentCrmStep.companyId ? String(fluentCrmStep.companyId) : logtoOrganizationId,
      status: MICRO_REQUEST_STATUSES.CONFLICT,
      payloadSnapshot: safeJson(payloadSnapshot?.crm || payloadSnapshot),
      lastError: { message: fluentCrmStep.message || "FluentCRM company conflict", reason: fluentCrmStep.reason || null, step: "crm.company" },
    });
  }

  if (fluentCrmStep.status === "error") {
    requests.push({
      ...base,
      microRequestType: "retry.crm.company.sync",
      targetEntityType: "crm_company",
      targetEntityId: logtoOrganizationId,
      status: MICRO_REQUEST_STATUSES.FAILED,
      payloadSnapshot: safeJson(payloadSnapshot?.crm || payloadSnapshot),
      lastError: { message: fluentCrmStep.message || "FluentCRM company sync failed", code: fluentCrmStep.code || null, diagnostic: fluentCrmStep.diagnostic || null, step: "crm.company" },
    });
  }

  for (const contact of fluentCrmStep.administrativeContacts || []) {
    const contactSync = contact.contactSync || {};
    if (!["error", "conflict"].includes(contactSync.status)) continue;
    const isConflict = contactSync.status === "conflict";
    requests.push({
      ...base,
      microRequestType: isConflict ? "resolve.conflict.contact.duplicate" : "retry.crm.contact.sync",
      targetEntityType: "crm_contact",
      targetEntityId: getContactTargetId(contact),
      status: isConflict ? MICRO_REQUEST_STATUSES.CONFLICT : MICRO_REQUEST_STATUSES.FAILED,
      payloadSnapshot: safeJson({ contact, companyId: fluentCrmStep.companyId || null }),
      lastError: { message: contactSync.reason || contactSync.message || "FluentCRM contact sync failed", diagnostic: contactSync.diagnostic || null, email: contact.email || null, step: `crm.contact.${contact.key || contact.email || "unknown"}` },
    });
  }

  return requests;
}

async function createBootstrapOperation({ actorUserId = null, payloadSnapshot, status = BOOTSTRAP_OPERATION_STATUSES.RUNNING, database = db } = {}) {
  const [operation] = await database.insert(organizationBootstrapOperations).values({ actorUserId, status, payloadSnapshot: safeJson(payloadSnapshot), stepResults: {} }).returning();
  return operation;
}

async function updateBootstrapOperation({ id, status, logtoOrganizationId, organizationProfileId, stepResults, lastError, database = db } = {}) {
  const [operation] = await database.update(organizationBootstrapOperations).set({ status, logtoOrganizationId, organizationProfileId, stepResults: safeJson(stepResults), lastError: safeJson(lastError), updatedAt: new Date(), completedAt: [BOOTSTRAP_OPERATION_STATUSES.SUCCEEDED, BOOTSTRAP_OPERATION_STATUSES.PARTIAL, BOOTSTRAP_OPERATION_STATUSES.FAILED].includes(status) ? new Date() : undefined }).where(eq(organizationBootstrapOperations.id, id)).returning();
  return operation;
}

async function insertMicroRequests(microRequests, { database = db } = {}) {
  if (!microRequests.length) return [];
  return database.insert(organizationBootstrapMicroRequests).values(microRequests.map((request) => ({ ...request, payloadSnapshot: safeJson(request.payloadSnapshot), lastError: safeJson(request.lastError) }))).returning();
}

async function listOpenMicroRequests({ limit = 50, database = db } = {}) {
  return database.select().from(organizationBootstrapMicroRequests).where(inArray(organizationBootstrapMicroRequests.status, OPEN_MICRO_REQUEST_STATUSES)).orderBy(desc(organizationBootstrapMicroRequests.createdAt)).limit(limit);
}

async function markMicroRequestForRetry({ id, database = db } = {}) {
  const [current] = await database.select().from(organizationBootstrapMicroRequests).where(eq(organizationBootstrapMicroRequests.id, id)).limit(1);
  if (!current) return null;
  const [updated] = await database.update(organizationBootstrapMicroRequests).set({ status: MICRO_REQUEST_STATUSES.QUEUED, retryCount: Number(current.retryCount || 0) + 1, lastError: null, updatedAt: new Date() }).where(eq(organizationBootstrapMicroRequests.id, id)).returning();
  return updated;
}

module.exports = {
  BOOTSTRAP_OPERATION_STATUSES,
  MICRO_REQUEST_STATUSES,
  buildMicroRequestsForFluentCrmStep,
  createBootstrapOperation,
  insertMicroRequests,
  listOpenMicroRequests,
  markMicroRequestForRetry,
  updateBootstrapOperation,
};
