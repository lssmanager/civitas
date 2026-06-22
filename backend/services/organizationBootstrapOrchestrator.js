const { randomUUID } = require("node:crypto");
const { QUEUE_NAMES, createQueue } = require("../queues/config");
const { LOGTO_SYNC_STATUSES, markOrganizationProfileFluentCrmSync, upsertOrganizationProfile } = require("./organizationProfiles");
const { normalizeCanonicalProvisioningInput, runCanonicalOrganizationBootstrap } = require("./organizationProvisioningCore");
const { buildLogtoOrganizationCustomData, normalizeExtendedProvisioningInput } = require("./organizationProvisioningSettings");
const { ensureOrganizationTagsAndLists, getOrCreateCompanyForOrganization, upsertContactFromLogtoIdentity } = require("./fluentCrm");
const { getOrCreateInternalUser } = require("./users");
const { OPERATION_STATUSES, PHASE_STATUSES, STEP_STATUSES, classifyOperationalError, createSyncOperation, getSyncOperationWithSteps, recordOperationStep, updateSyncOperation } = require("./syncOperations");
const { buildFluentCrmCompanyPayloadFromForm, buildFluentCrmContactPayloadFromAssignment } = require("./organizationProvisioningPayloads");

const STEP_NAMES = Object.freeze({ VALIDATE_INPUT: "validate_input", LOGTO_CANONICAL_BOOTSTRAP: "logto_canonical_bootstrap", RECONCILE_ORGANIZATION_PROFILE: "reconcile_organization_profile", PREPARE_CRM_PAYLOAD: "prepare_crm_payload", FLUENTCRM_COMPANY: "fluentcrm_company", FLUENTCRM_CONTACTS: "fluentcrm_contacts", FINALIZE: "finalize" });
const getSafeErrorMessage = (error) => error?.message || "Operational sync failed";
const getLogtoOrganizationName = (organization = {}) => organization.name || organization.organizationName || organization.displayName || null;
const log = (message, fields = {}) => console.log(JSON.stringify({ message, component: "organizationBootstrapOrchestrator", ...fields }));

function buildAuditContext({ authUser, internalUser, organization, operationId = null, correlationId = null }) { return { actorLogtoUserId: authUser?.sub || null, actorInternalUserId: internalUser?.id || null, organizationId: organization?.id || organization?.organizationId || null, organizationName: getLogtoOrganizationName(organization), operationId, correlationId }; }
function operationIdempotencyKey({ body = {}, actorUserId }) { return body.idempotencyKey || `organization.bootstrap:${actorUserId}:${String(body.name || "").trim().toLowerCase()}:${String(body.baseAdmin?.email || body.baseAdminEmail || "").trim().toLowerCase()}`; }

async function enqueueOrganizationBootstrap({ body, authUser, queue = null }) {
  const internalUser = await getOrCreateInternalUser(authUser);
  const canonicalInput = normalizeCanonicalProvisioningInput(body || {});
  const extendedInput = normalizeExtendedProvisioningInput(body || {});
  const errors = [...canonicalInput.errors, ...extendedInput.errors];
  if (errors.length > 0) {
    const error = new Error(errors[0].message);
    error.status = 400;
    error.details = errors;
    throw error;
  }
  const correlationId = body?.correlationId || randomUUID();
  const idempotencyKey = operationIdempotencyKey({ body, actorUserId: internalUser.id });
  const operation = await createSyncOperation({ operationType: "organization.bootstrap", entityType: "organization", correlationId, idempotencyKey, payloadSnapshotJson: { form: body || {}, canonical: canonicalInput.value, extended: extendedInput.value, fieldInventoryVersion: 1, sourcePolicy: { canonical: "logto", downstream: ["fluentcrm", "wordpress_buddyboss_future"], civitas: "operational_state" } } });
  const ownedQueue = !queue;
  queue = queue || createQueue(QUEUE_NAMES.ORGANIZATION_BOOTSTRAP);
  const job = await queue.add("organization.bootstrap", { operationId: operation.id, authUser, actorUserId: internalUser.id }, { jobId: operation.id });
  await recordOperationStep({ operationId: operation.id, stepName: STEP_NAMES.VALIDATE_INPUT, queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, jobId: job.id, status: STEP_STATUSES.COMPLETED, outputJson: { valid: true } });
  if (ownedQueue) await queue.close();
  return { operation, jobId: job.id };
}

async function runDownstreamFluentCrm({ operation, canonical, extended, logtoOrganization, logtoOrganizationId, administrativeContactAssignments, internalUser, authUser, job }) {
  await updateSyncOperation({ id: operation.id, status: OPERATION_STATUSES.DOWNSTREAM_RUNNING, downstreamStatus: PHASE_STATUSES.RUNNING });
  await recordOperationStep({ operationId: operation.id, stepName: STEP_NAMES.RECONCILE_ORGANIZATION_PROFILE, queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, jobId: job.id, attempt: job.attemptsMade + 1, status: STEP_STATUSES.RUNNING });
  const profile = await upsertOrganizationProfile({ logtoOrganizationId, nameCache: getLogtoOrganizationName(logtoOrganization) || canonical.name, type: extended.type || null, subdomain: extended.subdomain, slug: extended.slug, adminDomain: extended.adminDomain, seatTotal: extended.seatTotal, logtoSyncStatus: LOGTO_SYNC_STATUSES.BOOTSTRAPPED, logtoSyncError: null });
  await recordOperationStep({ operationId: operation.id, stepName: STEP_NAMES.RECONCILE_ORGANIZATION_PROFILE, queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, jobId: job.id, attempt: job.attemptsMade + 1, status: STEP_STATUSES.COMPLETED, outputJson: { organizationProfileId: profile.id, logtoOrganizationId } });
  await recordOperationStep({ operationId: operation.id, stepName: STEP_NAMES.PREPARE_CRM_PAYLOAD, queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, jobId: job.id, attempt: job.attemptsMade + 1, status: STEP_STATUSES.RUNNING });
  const normalizedCrm = buildFluentCrmCompanyPayloadFromForm({ form: operation.payloadSnapshotJson?.form || {}, canonical, extended });
  await recordOperationStep({ operationId: operation.id, stepName: STEP_NAMES.PREPARE_CRM_PAYLOAD, queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, jobId: job.id, attempt: job.attemptsMade + 1, status: STEP_STATUSES.COMPLETED, outputJson: { normalizedCrm, canonicalInputsUsed: ["logtoOrganizationId", "logtoUserIds", "roleNames"], fluentCrmIsCanonical: false } });
  await recordOperationStep({ operationId: operation.id, stepName: STEP_NAMES.FLUENTCRM_COMPANY, queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, jobId: job.id, attempt: job.attemptsMade + 1, status: STEP_STATUSES.RUNNING });
  const companyResult = await getOrCreateCompanyForOrganization(profile, { ...normalizedCrm, name: canonical.name, slug: extended.slug, adminDomain: extended.adminDomain }, { actorUserId: internalUser.id, auditMetadata: buildAuditContext({ authUser, internalUser, organization: logtoOrganization, operationId: operation.id, correlationId: operation.correlationId }) });
  if (companyResult.status === "conflict") {
    const conflict = { message: `FluentCRM company match is ambiguous (${companyResult.reason}); Civitas did not link a Company automatically.`, reason: companyResult.reason, retryable: false, system: "fluentcrm", category: "conflict" };
    await recordOperationStep({ operationId: operation.id, stepName: STEP_NAMES.FLUENTCRM_COMPANY, queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, jobId: job.id, attempt: job.attemptsMade + 1, status: STEP_STATUSES.FAILED, lastErrorJson: conflict });
    return { status: "partial_failed", profile, fluentcrm: { status: "conflict", ...conflict } };
  }
  const companyId = companyResult.company?.id ?? companyResult.company?.ID ?? companyResult.company?.company_id ?? null;
  await recordOperationStep({ operationId: operation.id, stepName: STEP_NAMES.FLUENTCRM_COMPANY, queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, jobId: job.id, attempt: job.attemptsMade + 1, status: STEP_STATUSES.COMPLETED, outputJson: { companyId, status: companyResult.status, responseSnapshot: companyResult.company } });
  await recordOperationStep({ operationId: operation.id, stepName: STEP_NAMES.FLUENTCRM_CONTACTS, queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, jobId: job.id, attempt: job.attemptsMade + 1, status: STEP_STATUSES.RUNNING });
  const taxonomy = await ensureOrganizationTagsAndLists({ logtoOrganizationId, slug: extended.slug, name: canonical.name });
  const organizationLists = [...new Set([...(normalizedCrm.lists || []), taxonomy.list?.title].filter(Boolean))];
  const organizationTags = [...new Set([...(normalizedCrm.tags || []), taxonomy.tag?.title].filter(Boolean))];
  const baseAdminAssignment = { ...(canonical.baseAdmin || {}), key: "base_admin", logtoUserId: operation.resultSnapshotJson?.canonical?.adminAssignment?.logtoUserId, roleName: canonical.baseAdmin?.initialOrganizationRole, organizationRoleName: canonical.baseAdmin?.initialOrganizationRole, status: "assigned" };
  const contactAssignments = [baseAdminAssignment, ...(administrativeContactAssignments || [])].filter((assignment) => assignment.email && assignment.logtoUserId);
  const administrativeContacts = [];
  for (const assignment of contactAssignments) {
    try { const contactPayload = buildFluentCrmContactPayloadFromAssignment({ assignment, companyId, organizationLists, organizationTags }); administrativeContacts.push({ ...assignment, contactSync: await upsertContactFromLogtoIdentity(contactPayload) }); }
    catch (error) { administrativeContacts.push({ ...assignment, contactSync: { status: "error", ...classifyOperationalError(error) } }); }
  }
  const contactFailures = administrativeContacts.filter((contact) => contact.contactSync?.status === "error" || contact.contactSync?.status === "conflict");
  await recordOperationStep({ operationId: operation.id, stepName: STEP_NAMES.FLUENTCRM_CONTACTS, queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, jobId: job.id, attempt: job.attemptsMade + 1, status: contactFailures.length ? STEP_STATUSES.FAILED : STEP_STATUSES.COMPLETED, outputJson: { companyId, taxonomy, administrativeContacts }, lastErrorJson: contactFailures.length ? { message: "One or more FluentCRM contact syncs failed", retryable: true, contacts: contactFailures } : null });
  if (contactFailures.length) await markOrganizationProfileFluentCrmSync({ id: profile.id, companyId: companyId == null ? null : String(companyId), status: "error", errorMessage: "One or more FluentCRM contact syncs failed" });
  return { status: contactFailures.length ? "partial_failed" : "completed", profile, fluentcrm: { status: companyResult.status, companyId, taxonomy, administrativeContacts } };
}

async function processOrganizationBootstrapJob(job) {
  const { operationId, authUser, actorUserId } = job.data;
  let operation = await getSyncOperationWithSteps(operationId);
  if (!operation) throw new Error(`sync operation ${operationId} not found`);
  const attempt = job.attemptsMade + 1;
  log("operation started", { operationId, jobId: job.id, queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, attempt, status: "running" });
  await updateSyncOperation({ id: operationId, status: OPERATION_STATUSES.RUNNING, canonicalStatus: PHASE_STATUSES.RUNNING, startedAt: new Date(), retryCount: attempt - 1 });
  const body = operation.payloadSnapshotJson?.form || {};
  const canonical = operation.payloadSnapshotJson?.canonical || normalizeCanonicalProvisioningInput(body).value;
  const extended = operation.payloadSnapshotJson?.extended || normalizeExtendedProvisioningInput(body).value;
  const internalUser = { id: actorUserId };
  try {
    await recordOperationStep({ operationId, stepName: STEP_NAMES.LOGTO_CANONICAL_BOOTSTRAP, queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, jobId: job.id, attempt, status: STEP_STATUSES.RUNNING });
    const canonicalResult = await runCanonicalOrganizationBootstrap({ canonical, logtoCustomData: buildLogtoOrganizationCustomData(extended, canonical, body.crm || {}), internalUser, auditContextBuilder: ({ organization }) => buildAuditContext({ authUser, internalUser, organization, operationId, correlationId: operation.correlationId }) });
    await recordOperationStep({ operationId, stepName: STEP_NAMES.LOGTO_CANONICAL_BOOTSTRAP, queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, jobId: job.id, attempt, status: STEP_STATUSES.COMPLETED, outputJson: { logtoOrganizationId: canonicalResult.logtoOrganizationId, adminAssignment: canonicalResult.adminAssignment, administrativeContactAssignments: canonicalResult.administrativeContactAssignments, jitProvisioning: canonicalResult.jitProvisioning, reconciled: canonicalResult.reconciled } });
    await updateSyncOperation({ id: operationId, status: OPERATION_STATUSES.CANONICAL_COMPLETED, canonicalStatus: PHASE_STATUSES.COMPLETED, logtoOrganizationId: canonicalResult.logtoOrganizationId, resultSnapshotJson: { canonical: canonicalResult } });
    operation = await getSyncOperationWithSteps(operationId);
    let downstream;
    try {
      downstream = await runDownstreamFluentCrm({ operation, canonical, extended, logtoOrganization: canonicalResult.logtoOrganization, logtoOrganizationId: canonicalResult.logtoOrganizationId, administrativeContactAssignments: canonicalResult.administrativeContactAssignments, internalUser, authUser, job });
    } catch (downstreamError) {
      const classifiedDownstreamError = classifyOperationalError(downstreamError);
      await recordOperationStep({ operationId, stepName: STEP_NAMES.FLUENTCRM_COMPANY, queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, jobId: job.id, attempt, status: STEP_STATUSES.FAILED, lastErrorJson: classifiedDownstreamError });
      await updateSyncOperation({ id: operationId, status: OPERATION_STATUSES.PARTIAL_FAILED, canonicalStatus: PHASE_STATUSES.COMPLETED, downstreamStatus: PHASE_STATUSES.FAILED, logtoOrganizationId: canonicalResult.logtoOrganizationId, resultSnapshotJson: { canonical: canonicalResult, downstream: { status: "error" } }, lastErrorJson: classifiedDownstreamError });
      return { operationId, status: OPERATION_STATUSES.PARTIAL_FAILED };
    }
    const finalStatus = downstream.status === "completed" ? OPERATION_STATUSES.COMPLETED : OPERATION_STATUSES.PARTIAL_FAILED;
    await recordOperationStep({ operationId, stepName: STEP_NAMES.FINALIZE, queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, jobId: job.id, attempt, status: STEP_STATUSES.COMPLETED, outputJson: { finalStatus } });
    await updateSyncOperation({ id: operationId, status: finalStatus, downstreamStatus: downstream.status === "completed" ? PHASE_STATUSES.COMPLETED : PHASE_STATUSES.FAILED, entityId: downstream.profile?.id || canonicalResult.logtoOrganizationId, resultSnapshotJson: { canonical: canonicalResult, downstream }, lastErrorJson: finalStatus === OPERATION_STATUSES.PARTIAL_FAILED ? downstream.fluentcrm : null });
    return { operationId, status: finalStatus };
  } catch (error) {
    const classified = classifyOperationalError(error);
    const canonicalCompleted = Boolean(error.provisioningState?.logtoOrganizationId);
    await updateSyncOperation({ id: operationId, status: canonicalCompleted ? OPERATION_STATUSES.PARTIAL_FAILED : OPERATION_STATUSES.FAILED, canonicalStatus: canonicalCompleted ? PHASE_STATUSES.COMPLETED : PHASE_STATUSES.FAILED, downstreamStatus: canonicalCompleted ? PHASE_STATUSES.FAILED : PHASE_STATUSES.SKIPPED, logtoOrganizationId: error.provisioningState?.logtoOrganizationId || operation.logtoOrganizationId, lastErrorJson: classified });
    log("operation failed", { operationId, jobId: job.id, queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, attempt, status: "failed", error: classified });
    if (classified.retryable === false && typeof job.discard === "function") job.discard();
    throw error;
  }
}

module.exports = { STEP_NAMES, enqueueOrganizationBootstrap, processOrganizationBootstrapJob };
