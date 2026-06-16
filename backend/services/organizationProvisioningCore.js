const {
  ORGANIZATION_ADMIN_ROLE_NAME,
  addUserToLogtoOrganization,
  assignOrganizationRoleToUser,
  createLogtoOrganization,
  updateLogtoOrganizationCustomData,
  ensureOrganizationTemplate,
  findLogtoOrganizationByName,
  findOrganizationRoleByName,
} = require("./logtoManagement");
const { AUDIT_ACTIONS, AUDIT_RESULTS, recordAuditLogBestEffort } = require("./auditLogs");
const { LOGTO_SYNC_STATUSES, markOrganizationProfileProvisioningStage, upsertOrganizationProfile } = require("./organizationProfiles");

const DEFAULT_ROLE_NAMES = [ORGANIZATION_ADMIN_ROLE_NAME];

const emptyToNull = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const normalizeRoleNames = (value) => {
  const input = Array.isArray(value) ? value : DEFAULT_ROLE_NAMES;
  const roles = input.map((role) => typeof role === "string" ? role.trim() : "").filter(Boolean);
  return Array.from(new Set(roles.length > 0 ? roles : DEFAULT_ROLE_NAMES));
};

const getLogtoOrganizationId = (organization) => organization.id || organization.organizationId || organization.logtoOrganizationId;
const getLogtoOrganizationName = (organization) => organization.name || organization.nameCache || null;

function normalizeCanonicalProvisioningInput(body = {}) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const baseAdmin = body.baseAdmin && typeof body.baseAdmin === "object" ? body.baseAdmin : {};
  const baseAdminName = emptyToNull(baseAdmin.name ?? body.baseAdminName);
  const baseAdminEmail = emptyToNull(baseAdmin.email ?? body.baseAdminEmail)?.toLowerCase() || null;
  const baseAdminLogtoUserId = emptyToNull(baseAdmin.logtoUserId ?? body.baseAdminLogtoUserId);
  const errors = [];
  if (!name) errors.push({ field: "name", message: "Organization name is required" });
  if (!baseAdminName) errors.push({ field: "baseAdmin.name", message: "Base admin name is required" });
  if (!baseAdminEmail) errors.push({ field: "baseAdmin.email", message: "Base admin email is required" });
  if (baseAdminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(baseAdminEmail)) errors.push({ field: "baseAdmin.email", message: "Base admin email must be a valid email address" });

  return {
    errors,
    value: {
      name,
      description: typeof body.description === "string" ? body.description.trim() : undefined,
      defaultRoleNames: normalizeRoleNames(body.defaultRoleNames),
      baseAdmin: { name: baseAdminName, email: baseAdminEmail, logtoUserId: baseAdminLogtoUserId },
    },
  };
}

async function resolveLogtoOrganizationForSync({ name, description, customData }) {
  const existingOrganization = await findLogtoOrganizationByName(name);
  if (existingOrganization) {
    const organizationId = getLogtoOrganizationId(existingOrganization);
    if (organizationId && customData && Object.keys(customData).length > 0) {
      const updatedOrganization = await updateLogtoOrganizationCustomData({ organizationId, customData });
      return { organization: updatedOrganization || existingOrganization, reconciled: true, customDataApplied: true, source: "pre_create_name_lookup_patch" };
    }
    return { organization: existingOrganization, reconciled: true, customDataApplied: false, source: "pre_create_name_lookup" };
  }

  const createdOrganization = await createLogtoOrganization({ name, description, customData });
  if (getLogtoOrganizationId(createdOrganization)) return { organization: createdOrganization, reconciled: false, customDataApplied: true, source: "create_response" };

  const reconciledOrganization = await findLogtoOrganizationByName(name);
  if (reconciledOrganization) return { organization: reconciledOrganization, reconciled: true, customDataApplied: false, source: "post_create_name_lookup" };

  const error = new Error("Logto organization creation succeeded but no organization id was returned or reconciled");
  error.logtoResponse = createdOrganization;
  throw error;
}

async function runCanonicalOrganizationBootstrap({ canonical, extendedProfileFields = {}, logtoCustomData = {}, authUser, internalUser, auditContextBuilder }) {
  let profile = null;
  let logtoOrganization = null;
  let logtoOrganizationId = null;
  let bootstrapStage = LOGTO_SYNC_STATUSES.PENDING;

  try {
  const requestedRoleNames = Array.from(new Set([ORGANIZATION_ADMIN_ROLE_NAME, ...canonical.defaultRoleNames]));
  const template = await ensureOrganizationTemplate({ requiredRoleNames: requestedRoleNames });
  await recordAuditLogBestEffort({ actorUserId: internalUser.id, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_TEMPLATE_VALIDATE, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "template_validated", requiredRoleNames: requestedRoleNames, availableRoleNames: template.roles.map((role) => role.name).filter(Boolean) } });

  const adminRole = await findOrganizationRoleByName(ORGANIZATION_ADMIN_ROLE_NAME);
  const adminRoleId = adminRole?.id || adminRole?.organizationRoleId || adminRole?.roleId || null;
  if (!adminRoleId) throw new Error(`Logto organization role ${ORGANIZATION_ADMIN_ROLE_NAME} exists but no role id was returned`);

  const resolvedLogtoOrganization = await resolveLogtoOrganizationForSync({ name: canonical.name, description: canonical.description, customData: logtoCustomData });
  logtoOrganization = resolvedLogtoOrganization.organization;
  logtoOrganizationId = getLogtoOrganizationId(logtoOrganization);
  bootstrapStage = LOGTO_SYNC_STATUSES.LOGTO_CREATED;
  if (!logtoOrganizationId) throw new Error("Logto organization reconciliation did not include an organization id");

  await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_LOGTO_CREATE, result: AUDIT_RESULTS.SUCCESS, metadata: { ...auditContextBuilder({ organization: logtoOrganization }), stage: bootstrapStage, name: canonical.name, logtoOrganizationId, customDataApplied: Boolean(resolvedLogtoOrganization.customDataApplied), customDataKeys: Object.keys(logtoCustomData || {}), reconciled: resolvedLogtoOrganization.reconciled, source: resolvedLogtoOrganization.source } });

  profile = await upsertOrganizationProfile({
    ...extendedProfileFields,
    logtoOrganizationId,
    nameCache: getLogtoOrganizationName(logtoOrganization) || canonical.name,
    defaultRoleNames: canonical.defaultRoleNames,
    logtoSyncStatus: LOGTO_SYNC_STATUSES.METADATA_LINKED,
  });
  bootstrapStage = LOGTO_SYNC_STATUSES.METADATA_LINKED;

  await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_METADATA_RECONCILE, result: AUDIT_RESULTS.SUCCESS, metadata: { ...auditContextBuilder({ organization: logtoOrganization }), stage: bootstrapStage, profileId: profile.id, logtoOrganizationId, localOnlyPreparedSettings: Object.keys(extendedProfileFields).filter((key) => extendedProfileFields[key] !== undefined && extendedProfileFields[key] !== null) } });

  const baseAdminLogtoUserId = canonical.baseAdmin.logtoUserId;
  if (!baseAdminLogtoUserId) {
    profile = await markOrganizationProfileProvisioningStage({ id: profile.id, status: LOGTO_SYNC_STATUSES.BASE_ADMIN_INVITATION_PENDING, errorMessage: "Base admin name/email were captured, but no Logto user id was provided; Logto invitation is pending." });
    bootstrapStage = LOGTO_SYNC_STATUSES.BASE_ADMIN_INVITATION_PENDING;
    await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_BASE_MEMBER, result: AUDIT_RESULTS.SUCCESS, metadata: { ...auditContextBuilder({ organization: logtoOrganization }), stage: bootstrapStage, baseAdmin: canonical.baseAdmin, actionRequired: "invite_or_create_logto_user" } });
    return { profile, logtoOrganization, logtoOrganizationId, bootstrapStage, partial: true };
  }

  profile = await markOrganizationProfileProvisioningStage({ id: profile.id, status: LOGTO_SYNC_STATUSES.BASE_MEMBER_PENDING, errorMessage: null });
  bootstrapStage = LOGTO_SYNC_STATUSES.BASE_MEMBER_PENDING;
  await addUserToLogtoOrganization({ organizationId: logtoOrganizationId, userId: baseAdminLogtoUserId });
  await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_BASE_MEMBER, result: AUDIT_RESULTS.SUCCESS, metadata: { ...auditContextBuilder({ organization: logtoOrganization }), stage: "base_member_added", baseAdmin: { ...canonical.baseAdmin, logtoUserId: baseAdminLogtoUserId } } });

  profile = await markOrganizationProfileProvisioningStage({ id: profile.id, status: LOGTO_SYNC_STATUSES.BASE_ROLE_PENDING, errorMessage: null });
  bootstrapStage = LOGTO_SYNC_STATUSES.BASE_ROLE_PENDING;
  await assignOrganizationRoleToUser({ organizationId: logtoOrganizationId, userId: baseAdminLogtoUserId, organizationRoleId: adminRoleId, organizationRoleName: ORGANIZATION_ADMIN_ROLE_NAME });
  await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_BASE_ROLE, result: AUDIT_RESULTS.SUCCESS, metadata: { ...auditContextBuilder({ organization: logtoOrganization }), stage: "base_role_assigned", roleName: ORGANIZATION_ADMIN_ROLE_NAME, roleId: adminRoleId, baseAdminLogtoUserId } });

  profile = await markOrganizationProfileProvisioningStage({ id: profile.id, logtoOrganizationId, nameCache: getLogtoOrganizationName(logtoOrganization) || canonical.name, status: LOGTO_SYNC_STATUSES.BOOTSTRAPPED, errorMessage: null, synced: true });
  bootstrapStage = LOGTO_SYNC_STATUSES.BOOTSTRAPPED;

  return { profile, logtoOrganization, logtoOrganizationId, bootstrapStage };
  } catch (error) {
    error.provisioningState = { profile, logtoOrganization, logtoOrganizationId, bootstrapStage };
    throw error;
  }
}

module.exports = { normalizeCanonicalProvisioningInput, runCanonicalOrganizationBootstrap };
