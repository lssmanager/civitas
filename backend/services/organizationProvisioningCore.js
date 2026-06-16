const {
  ORGANIZATION_ADMIN_ROLE_NAME,
  ORGANIZATION_STUDENT_ROLE_NAME,
  addUserToLogtoOrganization,
  assignOrganizationRoleToUser,
  createLogtoOrganization,
  createLogtoUser,
  updateLogtoOrganizationCustomData,
  ensureOrganizationTemplate,
  findLogtoOrganizationByName,
  findLogtoUserByEmail,
  findOrganizationRoleByName,
  getLogtoUserById,
  replaceOrganizationJitEmailDomains,
  replaceOrganizationJitRoles,
} = require("./logtoManagement");
const { AUDIT_ACTIONS, AUDIT_RESULTS, recordAuditLogBestEffort } = require("./auditLogs");

const DEFAULT_ADMIN_ROLE_NAMES = [ORGANIZATION_ADMIN_ROLE_NAME];
const DEFAULT_JIT_ROLE_NAMES = [ORGANIZATION_STUDENT_ROLE_NAME];
const RESERVED_ORGANIZATION_ROLE_NAMES = new Set([ORGANIZATION_ADMIN_ROLE_NAME, ORGANIZATION_STUDENT_ROLE_NAME]);

const emptyToNull = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const normalizeRoleNames = (value, fallback) => {
  const input = Array.isArray(value) ? value : fallback;
  const roles = input.map((role) => typeof role === "string" ? role.trim() : "").filter(Boolean);
  return Array.from(new Set(roles.length > 0 ? roles : fallback));
};

const getLogtoOrganizationId = (organization) => organization.id || organization.organizationId || organization.logtoOrganizationId;
const getLogtoOrganizationName = (organization) => organization.name || organization.nameCache || null;
const getLogtoUserId = (user = {}) => user.id || user.userId || user.sub || null;
const getOrganizationRoleId = (role = {}) => role.id || role.organizationRoleId || role.roleId || null;
const getLogtoUserEmail = (user = {}) => user.primaryEmail || user.email || user.profile?.email || null;

const assertRoleNameIsNotUserId = ({ value, field, errors }) => {
  if (value && RESERVED_ORGANIZATION_ROLE_NAMES.has(value)) {
    errors.push({ field, message: `${field} must be a Logto user id, not an organization role name` });
  }
};

function normalizeCanonicalProvisioningInput(body = {}) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const baseAdmin = body.baseAdmin && typeof body.baseAdmin === "object" ? body.baseAdmin : {};
  const jitProvisioning = body.jitProvisioning && typeof body.jitProvisioning === "object" ? body.jitProvisioning : {};
  const baseAdminName = emptyToNull(baseAdmin.name ?? body.baseAdminName);
  const baseAdminEmail = emptyToNull(baseAdmin.email ?? body.baseAdminEmail)?.toLowerCase() || null;
  const baseAdminLogtoUserId = emptyToNull(baseAdmin.logtoUserId ?? body.baseAdminLogtoUserId);
  const baseAdminInitialOrganizationRole = emptyToNull(baseAdmin.initialOrganizationRole) || ORGANIZATION_ADMIN_ROLE_NAME;
  const jitDomain = emptyToNull(jitProvisioning.domain ?? body.adminDomain ?? body.institutionalProvisioningDomain)?.toLowerCase() || null;
  const jitDefaultRoleNames = normalizeRoleNames(jitProvisioning.defaultRoleNames ?? body.defaultRoleNames, DEFAULT_JIT_ROLE_NAMES);
  const adminRoleNames = normalizeRoleNames([baseAdminInitialOrganizationRole], DEFAULT_ADMIN_ROLE_NAMES);
  const errors = [];
  if (!name) errors.push({ field: "name", message: "Organization name is required" });
  if (!baseAdminName) errors.push({ field: "baseAdmin.name", message: "Base admin name is required" });
  if (!baseAdminEmail) errors.push({ field: "baseAdmin.email", message: "Base admin email is required" });
  if (baseAdminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(baseAdminEmail)) errors.push({ field: "baseAdmin.email", message: "Base admin email must be a valid email address" });
  if (!jitDomain) errors.push({ field: "jitProvisioning.domain", message: "JIT provisioning domain is required" });
  if (jitDomain && !/^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(jitDomain)) errors.push({ field: "jitProvisioning.domain", message: "JIT provisioning domain must be a valid hostname such as colegio.edu.co" });
  if (!baseAdminInitialOrganizationRole) errors.push({ field: "baseAdmin.initialOrganizationRole", message: "Base admin organization role is required" });
  if (jitDefaultRoleNames.length === 0) errors.push({ field: "jitProvisioning.defaultRoleNames", message: "At least one JIT default organization role is required" });
  assertRoleNameIsNotUserId({ value: baseAdminLogtoUserId, field: "baseAdmin.logtoUserId", errors });

  return {
    errors,
    value: {
      name,
      description: typeof body.description === "string" ? body.description.trim() : undefined,
      requiredRoleNames: Array.from(new Set([...adminRoleNames, ...jitDefaultRoleNames])),
      baseAdmin: { name: baseAdminName, email: baseAdminEmail, logtoUserId: baseAdminLogtoUserId, initialOrganizationRole: baseAdminInitialOrganizationRole },
      jitProvisioning: { domain: jitDomain, defaultRoleNames: jitDefaultRoleNames },
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

async function getOrganizationRoleIdsByName(roleNames) {
  const entries = await Promise.all(roleNames.map(async (roleName) => {
    const role = await findOrganizationRoleByName(roleName);
    const roleId = getOrganizationRoleId(role);
    if (!roleId) throw new Error(`Logto organization role ${roleName} exists but no role id was returned`);
    return [roleName, roleId];
  }));
  return new Map(entries);
}

async function resolveBaseAdminUser({ baseAdmin }) {
  if (baseAdmin.logtoUserId) {
    const user = await getLogtoUserById(baseAdmin.logtoUserId);
    const logtoUserEmail = getLogtoUserEmail(user)?.toLowerCase() || null;
    if (logtoUserEmail !== baseAdmin.email) {
      const error = new Error("Base admin Logto user email does not match the requested base admin email");
      error.code = "BASE_ADMIN_EMAIL_MISMATCH";
      error.status = 409;
      error.diagnostic = "The provided baseAdmin.logtoUserId belongs to a different email than baseAdmin.email; admin assignment was stopped.";
      throw error;
    }
    return { user, userId: getLogtoUserId(user) || baseAdmin.logtoUserId, source: "provided_logto_user_id", created: false };
  }

  const existingUser = await findLogtoUserByEmail(baseAdmin.email);
  if (existingUser) {
    return { user: existingUser, userId: getLogtoUserId(existingUser), source: "resolved_by_email", created: false };
  }

  const createdUser = await createLogtoUser({ primaryEmail: baseAdmin.email, name: baseAdmin.name });
  return { user: createdUser, userId: getLogtoUserId(createdUser), source: "created_by_email", created: true };
}

async function configureJitProvisioning({ canonical, logtoOrganization, logtoOrganizationId, roleIdsByName, internalUser, auditContextBuilder }) {
  const organizationRoleIds = canonical.jitProvisioning.defaultRoleNames.map((roleName) => roleIdsByName.get(roleName));
  await replaceOrganizationJitEmailDomains({ organizationId: logtoOrganizationId, emailDomains: [canonical.jitProvisioning.domain] });
  await replaceOrganizationJitRoles({ organizationId: logtoOrganizationId, organizationRoleIds });
  await recordAuditLogBestEffort({
    actorUserId: internalUser.id,
    organizationId: logtoOrganizationId,
    action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING,
    result: AUDIT_RESULTS.SUCCESS,
    metadata: {
      ...auditContextBuilder({ organization: logtoOrganization }),
      stage: "jit_provisioning_configured",
      jitDomain: canonical.jitProvisioning.domain,
      defaultRoleNames: canonical.jitProvisioning.defaultRoleNames,
      organizationRoleIds,
    },
  });
  return { status: "configured", domain: canonical.jitProvisioning.domain, defaultRoleNames: canonical.jitProvisioning.defaultRoleNames, organizationRoleIds };
}

async function assignBaseAdminBestEffort({ canonical, logtoOrganization, logtoOrganizationId, roleIdsByName, internalUser, auditContextBuilder }) {
  const baseAdminUser = await resolveBaseAdminUser({ baseAdmin: canonical.baseAdmin });
  if (!baseAdminUser.userId) throw new Error("Resolved base admin Logto user did not include a user id");

  await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "base_admin_user_resolved", baseAdminLogtoUserId: baseAdminUser.userId, source: baseAdminUser.source, created: baseAdminUser.created } });

  const adminRoleName = canonical.baseAdmin.initialOrganizationRole;
  const adminRoleId = roleIdsByName.get(adminRoleName);
  if (!adminRoleId) throw new Error(`Logto organization role ${adminRoleName} exists but no role id was returned`);

  await addUserToLogtoOrganization({ organizationId: logtoOrganizationId, userId: baseAdminUser.userId });
  await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_BASE_MEMBER, result: AUDIT_RESULTS.SUCCESS, metadata: { ...auditContextBuilder({ organization: logtoOrganization }), stage: "base_member_added", baseAdminLogtoUserId: baseAdminUser.userId } });

  await assignOrganizationRoleToUser({ organizationId: logtoOrganizationId, userId: baseAdminUser.userId, organizationRoleId: adminRoleId, organizationRoleName: adminRoleName });
  await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_BASE_ROLE, result: AUDIT_RESULTS.SUCCESS, metadata: { ...auditContextBuilder({ organization: logtoOrganization }), stage: "base_role_assigned", roleName: adminRoleName, roleId: adminRoleId, baseAdminLogtoUserId: baseAdminUser.userId } });

  return { status: "assigned", logtoUserId: baseAdminUser.userId, userCreated: baseAdminUser.created, userResolution: baseAdminUser.source, roleName: adminRoleName, roleId: adminRoleId };
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

    const template = await ensureOrganizationTemplate({ requiredRoleNames: canonical.requiredRoleNames });
    await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_TEMPLATE_VALIDATE, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "template_validated", requiredRoleNames: canonical.requiredRoleNames, availableRoleNames: template.roles.map((role) => role.name).filter(Boolean) } });
    const roleIdsByName = await getOrganizationRoleIdsByName(canonical.requiredRoleNames);

    const jitProvisioning = await configureJitProvisioning({ canonical, logtoOrganization, logtoOrganizationId, roleIdsByName, internalUser, auditContextBuilder });
    const adminAssignment = await assignBaseAdminBestEffort({ canonical, logtoOrganization, logtoOrganizationId, roleIdsByName, internalUser, auditContextBuilder });

    return {
      logtoOrganization,
      logtoOrganizationId,
      canonicalCreated: true,
      reconciled: resolvedLogtoOrganization.reconciled,
      customDataApplied: Boolean(resolvedLogtoOrganization.customDataApplied),
      adminAssignment,
      jitProvisioning,
      status: "created_with_admin_and_jit_configured",
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
