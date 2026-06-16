const {
  ORGANIZATION_ADMIN_ROLE_NAME,
  addUserToLogtoOrganization,
  assignOrganizationRoleToUser,
  createLogtoOrganization,
  updateLogtoOrganizationCustomData,
  ensureOrganizationTemplate,
  findLogtoOrganizationByName,
  findOrganizationRoleByName,
  getLogtoUserById,
} = require("./logtoManagement");
const { AUDIT_ACTIONS, AUDIT_RESULTS, recordAuditLogBestEffort } = require("./auditLogs");

const DEFAULT_ROLE_NAMES = [ORGANIZATION_ADMIN_ROLE_NAME];

const emptyToNull = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const normalizeRoleNames = (value) => {
  const input = Array.isArray(value) ? value : DEFAULT_ROLE_NAMES;
  const roles = input.map((role) => typeof role === "string" ? role.trim() : "").filter(Boolean);
  return Array.from(new Set(roles.length > 0 ? roles : DEFAULT_ROLE_NAMES));
};

const getLogtoOrganizationId = (organization) => organization.id || organization.organizationId || organization.logtoOrganizationId;
const getLogtoOrganizationName = (organization) => organization.name || organization.nameCache || null;
const getOrganizationRoleId = (role = {}) => role.id || role.organizationRoleId || role.roleId || null;

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

async function assignBaseAdminBestEffort({ canonical, logtoOrganization, logtoOrganizationId, internalUser, auditContextBuilder }) {
  const baseAdminLogtoUserId = canonical.baseAdmin.logtoUserId;
  if (!baseAdminLogtoUserId) {
    await recordAuditLogBestEffort({
      actorUserId: internalUser.id,
      organizationId: logtoOrganizationId,
      action: AUDIT_ACTIONS.OWNER_ORGANIZATION_BASE_MEMBER,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: {
        ...auditContextBuilder({ organization: logtoOrganization }),
        stage: "base_admin_skipped_missing_logto_user_id",
        baseAdmin: canonical.baseAdmin,
        actionRequired: "provide_existing_logto_user_id_before_assigning_organization_admin",
      },
    });

    return {
      status: "skipped_missing_logto_user_id",
      message: "Organization was created canonically in Logto; base admin assignment was skipped because no existing Logto user id was provided.",
    };
  }

  const requestedRoleNames = Array.from(new Set([ORGANIZATION_ADMIN_ROLE_NAME, ...canonical.defaultRoleNames]));
  const template = await ensureOrganizationTemplate({ requiredRoleNames: requestedRoleNames });
  await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_TEMPLATE_VALIDATE, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "template_validated", requiredRoleNames: requestedRoleNames, availableRoleNames: template.roles.map((role) => role.name).filter(Boolean) } });

  await getLogtoUserById(baseAdminLogtoUserId);
  await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "base_admin_user_validated", baseAdminLogtoUserId } });

  const adminRole = await findOrganizationRoleByName(ORGANIZATION_ADMIN_ROLE_NAME);
  const adminRoleId = getOrganizationRoleId(adminRole);
  if (!adminRoleId) throw new Error(`Logto organization role ${ORGANIZATION_ADMIN_ROLE_NAME} exists but no role id was returned`);

  await addUserToLogtoOrganization({ organizationId: logtoOrganizationId, userId: baseAdminLogtoUserId });
  await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_BASE_MEMBER, result: AUDIT_RESULTS.SUCCESS, metadata: { ...auditContextBuilder({ organization: logtoOrganization }), stage: "base_member_added", baseAdmin: { ...canonical.baseAdmin, logtoUserId: baseAdminLogtoUserId } } });

  await assignOrganizationRoleToUser({ organizationId: logtoOrganizationId, userId: baseAdminLogtoUserId, organizationRoleId: adminRoleId, organizationRoleName: ORGANIZATION_ADMIN_ROLE_NAME });
  await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_BASE_ROLE, result: AUDIT_RESULTS.SUCCESS, metadata: { ...auditContextBuilder({ organization: logtoOrganization }), stage: "base_role_assigned", roleName: ORGANIZATION_ADMIN_ROLE_NAME, roleId: adminRoleId, baseAdminLogtoUserId } });

  return {
    status: "assigned",
    logtoUserId: baseAdminLogtoUserId,
    roleName: ORGANIZATION_ADMIN_ROLE_NAME,
  };
}

async function runCanonicalOrganizationBootstrap({ canonical, logtoCustomData = {}, internalUser, auditContextBuilder }) {
  let logtoOrganization = null;
  let logtoOrganizationId = null;

  try {
    const resolvedLogtoOrganization = await resolveLogtoOrganizationForSync({ name: canonical.name, description: canonical.description, customData: logtoCustomData });
    logtoOrganization = resolvedLogtoOrganization.organization;
    logtoOrganizationId = getLogtoOrganizationId(logtoOrganization);
    if (!logtoOrganizationId) throw new Error("Logto organization reconciliation did not include an organization id");

    await recordAuditLogBestEffort({
      actorUserId: internalUser.id,
      organizationId: logtoOrganizationId,
      action: AUDIT_ACTIONS.OWNER_ORGANIZATION_LOGTO_CREATE,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: {
        ...auditContextBuilder({ organization: logtoOrganization }),
        stage: "logto_canonical_created",
        name: canonical.name,
        logtoOrganizationId,
        customDataApplied: Boolean(resolvedLogtoOrganization.customDataApplied),
        customDataKeys: Object.keys(logtoCustomData || {}),
        reconciled: resolvedLogtoOrganization.reconciled,
        source: resolvedLogtoOrganization.source,
      },
    });

    const adminAssignment = await assignBaseAdminBestEffort({ canonical, logtoOrganization, logtoOrganizationId, internalUser, auditContextBuilder });

    return {
      logtoOrganization,
      logtoOrganizationId,
      canonicalCreated: true,
      reconciled: resolvedLogtoOrganization.reconciled,
      customDataApplied: Boolean(resolvedLogtoOrganization.customDataApplied),
      adminAssignment,
      status: adminAssignment.status === "assigned" ? "created_with_admin_assigned" : "created_admin_assignment_skipped",
    };
  } catch (error) {
    error.provisioningState = { logtoOrganization, logtoOrganizationId, canonicalCreated: Boolean(logtoOrganizationId) };
    throw error;
  }
}

async function resumeOrganizationBootstrap(options) {
  return runCanonicalOrganizationBootstrap(options);
}

module.exports = { normalizeCanonicalProvisioningInput, resumeOrganizationBootstrap, runCanonicalOrganizationBootstrap };
