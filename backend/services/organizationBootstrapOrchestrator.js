const { randomUUID } = require("node:crypto");
const { UnrecoverableError } = require("bullmq");
const { QUEUE_NAMES, createQueue } = require("../queues/config");
const { LOGTO_SYNC_STATUSES, markOrganizationProfileFluentCrmSync, upsertOrganizationProfile } = require("./organizationProfiles");
const { normalizeCanonicalProvisioningInput, runCanonicalOrganizationBootstrap } = require("./organizationProvisioningCore");
const { buildLogtoOrganizationCustomData, normalizeExtendedProvisioningInput } = require("./organizationProvisioningSettings");
const { ensureOrganizationTagsAndLists, getOrCreateCompanyForOrganization, syncOrganizationContactsToFluentCrm } = require("./fluentCrm");
const { getOrCreateInternalUser } = require("./users");
const { OPERATION_STATUSES, PHASE_STATUSES, STEP_STATUSES, classifyOperationalError, createSyncOperation, getSyncOperationWithSteps, recordOperationStep, updateSyncOperation } = require("./syncOperations");
const { buildFluentCrmCompanyPayloadFromForm } = require("./organizationProvisioningPayloads");
const { listLogtoOrganizationRoles, listLogtoOrganizationUserRoles, listLogtoOrganizationUsers } = require("./logtoManagement");
const { getEffectiveCrmRoleMapping } = require("./crmRoleMappings");

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
  const contactStartedAt = new Date();
  await recordOperationStep({ operationId: operation.id, stepName: STEP_NAMES.FLUENTCRM_CONTACTS, queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, jobId: job.id, attempt: job.attemptsMade + 1, status: STEP_STATUSES.RUNNING, outputJson: { status: "processing_contacts", humanMessage: "Worker tomó la sincronización de contactos hacia FluentCRM", companyId } });
  const taxonomy = await ensureOrganizationTagsAndLists({ logtoOrganizationId, slug: extended.slug, name: canonical.name });
  const members = await listLogtoOrganizationUsers({ organizationId: logtoOrganizationId });
  const logtoRoles = await listLogtoOrganizationRoles();
  const roleMapping = (await getEffectiveCrmRoleMapping({ logtoRoles })).mapping;
  const contactSummary = await syncOrganizationContactsToFluentCrm({
    profile: { ...profile, fluentcrmCompanyId: companyId },
    members,
    roleMapping,
    getMemberRoles: async (logtoUserId) => (await listLogtoOrganizationUserRoles({ organizationId: logtoOrganizationId, userId: logtoUserId }))
      .map((role) => role.name || role.nameCache || role.key || role.organizationRoleName)
      .filter(Boolean),
    audit: async (event) => null,
    markOrganizationSync: async (summaryToPersist) => markOrganizationProfileFluentCrmSync({
      id: profile.id,
      companyId: companyId == null ? null : String(companyId),
      status: summaryToPersist.status === "synced" ? "linked" : summaryToPersist.status === "conflict" || summaryToPersist.recoveryStatus === "manual_retry_required" ? "conflict" : "error",
      errorMessage: summaryToPersist.errors?.[0]?.reason || null,
      synced: summaryToPersist.status === "synced",
      settings: { ...(profile.settings || {}), fluentcrmContactSync: { ...summaryToPersist, persistencePolicy: "summary_only_no_contact_profile_replication" } },
    }),
    onContactProgress: async (event) => recordOperationStep({
      operationId: operation.id,
      stepName: `fluentcrm_contacts.contact.${event.index}_of_${event.total}.${event.action}`,
      queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP,
      jobId: job.id,
      attempt: job.attemptsMade + 1,
      status: event.result === "running" ? STEP_STATUSES.RUNNING : ["created", "updated"].includes(event.result) ? STEP_STATUSES.COMPLETED : STEP_STATUSES.FAILED,
      outputJson: { ...event, entityType: "fluentcrm.contact", affectedSystem: "FluentCRM", status: event.status || "processing_contact_n_of_x" },
      lastErrorJson: ["created", "updated", "running"].includes(event.result) ? null : { message: event.humanMessage, retryable: Boolean(event.retryable), retryState: event.retryState, requiresHumanAction: Boolean(event.requiresHumanAction) },
    }),
  });
  const contactFinishedAt = new Date();
  const finalContactStatus = contactSummary.status === "synced" ? STEP_STATUSES.COMPLETED : STEP_STATUSES.FAILED;
  await recordOperationStep({ operationId: operation.id, stepName: STEP_NAMES.FLUENTCRM_CONTACTS, queueName: QUEUE_NAMES.ORGANIZATION_BOOTSTRAP, jobId: job.id, attempt: job.attemptsMade + 1, status: finalContactStatus, outputJson: { companyId, taxonomy, status: contactSummary.status, humanMessage: contactSummary.status === "synced" ? `Contactos sincronizados: ${contactSummary.succeeded}/${contactSummary.total}` : `Contactos sincronizados parcialmente: ${contactSummary.succeeded}/${contactSummary.total}`, summary: { ...contactSummary, startedAt: contactSummary.startedAt || contactStartedAt.toISOString(), finishedAt: contactSummary.finishedAt || contactFinishedAt.toISOString(), durationMs: contactSummary.durationMs ?? contactFinishedAt.getTime() - contactStartedAt.getTime() } }, lastErrorJson: finalContactStatus === STEP_STATUSES.COMPLETED ? null : { message: "One or more FluentCRM contact syncs require recovery", retryable: contactSummary.retryAutomatic > 0, retryState: contactSummary.status, requiresHumanAction: contactSummary.humanActionRequired > 0, summary: contactSummary } });
  const downstreamStatus = contactSummary.status === "synced" ? "completed" : "partial_failed";
  return { status: downstreamStatus, profile, fluentcrm: { status: companyResult.status, companyId, taxonomy, contactSync: contactSummary } };
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
    if (classified.retryable === false) {
      // BullMQ should retry transient infrastructure failures, but Logto/CRM 4xx
      // validation conflicts are functional incidents: mark the job failed once so
      // /owner/system shows executed-and-non-recoverable instead of pending work.
      throw new UnrecoverableError(error.message || "Unrecoverable organization bootstrap failure");
    }
    throw error;
  }
}

module.exports = { STEP_NAMES, enqueueOrganizationBootstrap, processOrganizationBootstrapJob };
