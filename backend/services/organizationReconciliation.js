const { desc, eq, like } = require("drizzle-orm");
const { db } = require("../db/client");
const { syncOperations } = require("../db/schema");
const { AUDIT_ACTIONS, AUDIT_RESULTS, recordAuditLogBestEffort } = require("./auditLogs");
const { LOGTO_SYNC_STATUSES, upsertOrganizationProfile } = require("./organizationProfiles");
let enqueueSyncOperation = async () => ({ enqueued: false });
try { ({ enqueueSyncOperation } = require("./syncQueue")); } catch (_error) { enqueueSyncOperation = async () => ({ enqueued: false }); }

const RECONCILIATION_OPERATION_TYPE = "organization.reconciliation_task";
const OPEN_TASK_STATUSES = new Set(["pending", "queued", "processing", "hitl_required", "failed"]);

const TASK_TYPES = Object.freeze({
  LOGTO_ORG_MISSING_LOCAL_PROFILE: "logto_org_missing_local_profile",
  LOCAL_PROFILE_WITHOUT_LOGTO_ORG: "local_profile_without_logto_org",
  DUPLICATE_LOCAL_PROFILES_FOR_LOGTO_ORG: "duplicate_local_profiles_for_logto_org",
  NAME_MATCH_PENDING_LINK: "name_match_pending_link",
});

const safeJson = (value) => (value === undefined ? null : value);
const toIso = (value) => value?.toISOString?.() ?? value ?? null;
const normalizeStatus = (status) => (status === "queued" ? "pending" : status);
const dedupeKeyFor = ({ type, logtoOrganizationId = null, profileId = null }) => `reconciliation:${type}:${logtoOrganizationId || profileId || "unknown"}`;
const SECRET_KEY_PATTERN = /(secret|token|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|internal[-_ ]?secret[-_ ]?ref)/i;

function redactEvidence(value) {
  if (Array.isArray(value)) return value.map(redactEvidence);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => {
    if (SECRET_KEY_PATTERN.test(key)) {
      return [key, nestedValue ? "[redacted]" : nestedValue];
    }
    return [key, redactEvidence(nestedValue)];
  }));
}


function taskPayload({ type, status, sourceSystem = "logto", targetSystem = "civitas", logtoOrganizationId = null, profileId = null, severity = "warning", requiresHuman = true, suggestedAction, evidence = {}, resolution = null }) {
  return { type, status, sourceSystem, targetSystem, logtoOrganizationId, profileId, severity, requiresHuman, suggestedAction, evidence: redactEvidence(evidence), resolution };
}

function serializeReconciliationTask(operation = {}) {
  const payload = operation.payloadSnapshotJson || {};
  const result = operation.resultSnapshotJson || {};
  return {
    id: operation.id,
    type: payload.type || operation.operationType,
    status: result.status || operation.status,
    sourceSystem: payload.sourceSystem || "logto",
    targetSystem: payload.targetSystem || "civitas",
    logtoOrganizationId: operation.logtoOrganizationId || payload.logtoOrganizationId || null,
    profileId: operation.entityId || payload.profileId || null,
    dedupeKey: operation.idempotencyKey,
    severity: payload.severity || "warning",
    requiresHuman: Boolean(payload.requiresHuman),
    suggestedAction: payload.suggestedAction || null,
    evidence: payload.evidence || {},
    resolution: result.resolution || payload.resolution || null,
    createdAt: toIso(operation.createdAt),
    updatedAt: toIso(operation.updatedAt),
    resolvedAt: toIso(operation.finishedAt),
  };
}

async function upsertReconciliationTask(task, { database = db } = {}) {
  const dedupeKey = task.dedupeKey || dedupeKeyFor(task);
  const status = normalizeStatus(task.status || (task.requiresHuman ? "hitl_required" : "pending"));
  const [existing] = await database.select().from(syncOperations).where(eq(syncOperations.idempotencyKey, dedupeKey)).limit(1);
  const payloadSnapshotJson = taskPayload({ ...task, status });
  const resultSnapshotJson = { status, resolution: task.resolution || null };

  if (existing) {
    const currentStatus = normalizeStatus(existing.status);
    const previouslyIgnored = currentStatus === "ignored";
    const evidenceChanged = JSON.stringify(existing.payloadSnapshotJson?.evidence || {}) !== JSON.stringify(payloadSnapshotJson.evidence || {});
    if (["completed", "resolved"].includes(currentStatus) && !evidenceChanged) return existing;
    if (previouslyIgnored && !evidenceChanged) return existing;

    const [updated] = await database.update(syncOperations).set({
      status: previouslyIgnored && evidenceChanged ? status : existing.status,
      canonicalStatus: payloadSnapshotJson.requiresHuman ? "hitl_required" : "pending",
      downstreamStatus: "pending",
      payloadSnapshotJson,
      resultSnapshotJson: { ...(existing.resultSnapshotJson || {}), ...resultSnapshotJson },
      lastErrorJson: null,
      updatedAt: new Date(),
    }).where(eq(syncOperations.id, existing.id)).returning();
    return updated;
  }

  const [created] = await database.insert(syncOperations).values({
    operationType: RECONCILIATION_OPERATION_TYPE,
    entityType: "organization_reconciliation_task",
    entityId: task.profileId || task.logtoOrganizationId || null,
    logtoOrganizationId: task.logtoOrganizationId || null,
    status,
    canonicalStatus: payloadSnapshotJson.requiresHuman ? "hitl_required" : "pending",
    downstreamStatus: "pending",
    correlationId: dedupeKey,
    idempotencyKey: dedupeKey,
    payloadSnapshotJson,
    resultSnapshotJson,
    retryCount: 0,
  }).returning();
  if (!payloadSnapshotJson.requiresHuman) await enqueueSyncOperation(created).catch((error) => console.error("Failed to enqueue reconciliation task", { taskId: created.id, error }));
  return created;
}

function buildTaskSummary(tasks = []) {
  return tasks.reduce((summary, task) => {
    const status = normalizeStatus(task.status);
    if (["pending", "queued", "processing"].includes(status)) summary.pending += 1;
    if (status === "hitl_required") summary.hitlRequired += 1;
    if (status === "failed") summary.failed += 1;
    return summary;
  }, { pending: 0, hitlRequired: 0, failed: 0 });
}

async function materializeReconciliationTasks({ organizations = [], reconciliationIncidents = [] }, { database = db } = {}) {
  const taskInputs = [];
  for (const organization of organizations) {
    const evidence = { logto: { id: organization.logtoOrganizationId, name: organization.name, canonical: organization.canonical }, civitas: { profile: organization.profile }, matchedFields: organization.reconciliation?.matchedBy ? [organization.reconciliation.matchedBy] : [], confidence: organization.reconciliation?.matchedBy === "name" ? 0.8 : 1 };
    if (["ready_to_seed_profile", "missing_required_profile_metadata"].includes(organization.reconciliation?.status)) {
      const hasMinimumMetadata = Boolean((organization.canonical?.appSubdomain || organization.canonical?.slug) && (organization.canonical?.inviteDomain || organization.canonical?.institutionalDomain || organization.canonical?.name));
      taskInputs.push({ type: TASK_TYPES.LOGTO_ORG_MISSING_LOCAL_PROFILE, sourceSystem: "logto", targetSystem: "civitas", logtoOrganizationId: organization.logtoOrganizationId, status: hasMinimumMetadata ? "pending" : "hitl_required", requiresHuman: !hasMinimumMetadata, severity: hasMinimumMetadata ? "info" : "warning", suggestedAction: hasMinimumMetadata ? "Crear profile local mínimo desde metadata normalizada de Logto" : "Completar metadata obligatoria antes de crear el profile local.", evidence });
    }
    if (organization.reconciliation?.duplicateProfileIds?.length > 0) {
      taskInputs.push({ type: TASK_TYPES.DUPLICATE_LOCAL_PROFILES_FOR_LOGTO_ORG, logtoOrganizationId: organization.logtoOrganizationId, profileId: organization.reconciliation.canonicalProfileId, canonicalProfileId: organization.reconciliation.canonicalProfileId, duplicateProfileIds: organization.reconciliation.duplicateProfileIds, status: "hitl_required", requiresHuman: true, severity: "critical", suggestedAction: "Seleccionar profile canónico y decidir fusionar, archivar o conservar duplicados.", evidence: { ...evidence, civitas: { profileIds: organization.reconciliation.profileIds, canonicalProfileId: organization.reconciliation.canonicalProfileId, duplicateProfileIds: organization.reconciliation.duplicateProfileIds } } });
    }
    if (organization.reconciliation?.status === "name_match_pending_link") {
      taskInputs.push({ type: TASK_TYPES.NAME_MATCH_PENDING_LINK, logtoOrganizationId: organization.logtoOrganizationId, profileId: organization.reconciliation.canonicalProfileId, status: "hitl_required", requiresHuman: true, severity: "warning", suggestedAction: "Revisar evidencia y aprobar o rechazar vínculo por nombre; no se vincula automáticamente.", evidence: { ...evidence, matchedFields: ["name"], confidence: 0.8 } });
    }
  }
  for (const incident of reconciliationIncidents) {
    if (!incident.profile?.id) continue;
    taskInputs.push({ type: TASK_TYPES.LOCAL_PROFILE_WITHOUT_LOGTO_ORG, sourceSystem: "civitas", targetSystem: "logto", profileId: incident.profile.id, logtoOrganizationId: incident.profile.logtoOrganizationId || null, status: "hitl_required", requiresHuman: true, severity: "warning", suggestedAction: "Vincular a Logto, crear organización Logto con aprobación, archivar, marcar legacy o ignorar.", evidence: { logto: null, civitas: { profile: incident.profile }, matchedFields: [], confidence: 0 } });
  }
  const tasks = [];
  for (const input of taskInputs) tasks.push(await upsertReconciliationTask({ ...input, dedupeKey: dedupeKeyFor(input) }, { database }));
  return { tasks: tasks.map(serializeReconciliationTask), reconciliationTasksSummary: buildTaskSummary(tasks) };
}

async function processReconciliationTask(operation) {
  const payload = operation.payloadSnapshotJson || {};
  if (payload.requiresHuman) {
    const [updated] = await db.update(syncOperations).set({ status: "hitl_required", canonicalStatus: "hitl_required", resultSnapshotJson: { ...(operation.resultSnapshotJson || {}), status: "hitl_required", workerOutcome: { requiresHuman: true } }, updatedAt: new Date() }).where(eq(syncOperations.id, operation.id)).returning();
    await recordAuditLogBestEffort({ organizationId: operation.logtoOrganizationId || null, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_METADATA_RECONCILE, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "worker.reconciliation.hitl_required", taskId: operation.id, type: payload.type } });
    return { status: "hitl_required", task: serializeReconciliationTask(updated) };
  }

  if (payload.type === TASK_TYPES.LOGTO_ORG_MISSING_LOCAL_PROFILE) {
    const canonical = payload.evidence?.logto?.canonical || {};
    const customData = canonical.customData || {};
    const provisioning = customData.provisioning || {};
    const civitasProfile = customData.civitasProfile || {};
    const business = civitasProfile.business || {};
    const branding = civitasProfile.branding || {};
    const profile = await upsertOrganizationProfile({
      logtoOrganizationId: operation.logtoOrganizationId,
      nameCache: canonical.name || payload.evidence?.logto?.name || null,
      type: business.type || provisioning.type || null,
      subdomain: canonical.appSubdomain || provisioning.appSubdomain || customData.subdomain || null,
      slug: canonical.slug || provisioning.slug || null,
      adminDomain: canonical.adminDomain || canonical.institutionalDomain || provisioning.institutionalDomain || null,
      logoUrl: branding.logoUrl || branding.lightLogoUrl || null,
      faviconUrl: branding.faviconUrl || branding.lightFaviconUrl || null,
      primaryColor: branding.primaryColor || branding.lightPrimaryColor || null,
      primaryColorDark: branding.primaryColorDark || branding.darkPrimaryColor || null,
      settings: { source: "logto_normalized_metadata", business: { ...business, inviteDomain: canonical.inviteDomain || canonical.institutionalDomain || null }, contact: civitasProfile.contact || {}, branding, legacyCustomData: customData },
      seatTotal: Number(provisioning.seatTotal || civitasProfile.seatTotal || 0) || 0,
      logtoSyncStatus: LOGTO_SYNC_STATUSES.METADATA_LINKED || "metadata_linked",
      logtoSyncError: null,
    });
    const [updated] = await db.update(syncOperations).set({ status: "resolved", canonicalStatus: "completed", downstreamStatus: "completed", resultSnapshotJson: { ...(operation.resultSnapshotJson || {}), status: "resolved", workerOutcome: { action: "created_local_profile", profileId: profile.id } }, updatedAt: new Date(), finishedAt: new Date() }).where(eq(syncOperations.id, operation.id)).returning();
    await recordAuditLogBestEffort({ organizationId: operation.logtoOrganizationId || null, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_METADATA_RECONCILE, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "worker.reconciliation.created_local_profile", taskId: operation.id, profileId: profile.id } });
    return { status: "resolved", task: serializeReconciliationTask(updated), profile };
  }

  const [updated] = await db.update(syncOperations).set({ status: "hitl_required", canonicalStatus: "hitl_required", resultSnapshotJson: { ...(operation.resultSnapshotJson || {}), status: "hitl_required", workerOutcome: { requiresHuman: true, reason: "unsafe_or_ambiguous_reconciliation" } }, updatedAt: new Date() }).where(eq(syncOperations.id, operation.id)).returning();
  await recordAuditLogBestEffort({ organizationId: operation.logtoOrganizationId || null, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_METADATA_RECONCILE, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "worker.reconciliation.escalated", taskId: operation.id, type: payload.type } });
  return { status: "hitl_required", task: serializeReconciliationTask(updated) };
}

async function listReconciliationTasks({ limit = 100 } = {}) {
  const rows = await db.select().from(syncOperations).where(like(syncOperations.idempotencyKey, "reconciliation:%")).orderBy(desc(syncOperations.updatedAt)).limit(limit);
  return rows.map(serializeReconciliationTask);
}

async function resolveReconciliationTask({ taskId, action, actorUserId = null, reason = null, before = null, after = null }) {
  const [existing] = await db.select().from(syncOperations).where(eq(syncOperations.id, taskId)).limit(1);
  if (!existing || !String(existing.idempotencyKey || "").startsWith("reconciliation:")) throw Object.assign(new Error("Reconciliation task not found"), { status: 404 });
  const statusByAction = { ignore: "ignored", retry: "pending" };
  const nextStatus = statusByAction[action] || "resolved";
  const resolution = { action, actorUserId, timestamp: new Date().toISOString(), before: safeJson(before), after: safeJson(after), reason, taskId, logtoOrganizationId: existing.logtoOrganizationId || null, profileId: existing.entityId || null };
  const [updated] = await db.update(syncOperations).set({ status: nextStatus, resultSnapshotJson: { ...(existing.resultSnapshotJson || {}), status: nextStatus, resolution }, updatedAt: new Date(), finishedAt: ["resolved", "ignored"].includes(nextStatus) ? new Date() : null }).where(eq(syncOperations.id, taskId)).returning();
  await recordAuditLogBestEffort({ actorUserId, organizationId: existing.logtoOrganizationId || null, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_METADATA_RECONCILE, result: AUDIT_RESULTS.SUCCESS, metadata: resolution });
  return serializeReconciliationTask(updated);
}

module.exports = { RECONCILIATION_OPERATION_TYPE, TASK_TYPES, OPEN_TASK_STATUSES, buildTaskSummary, materializeReconciliationTasks, listReconciliationTasks, processReconciliationTask, resolveReconciliationTask, serializeReconciliationTask, upsertReconciliationTask };
