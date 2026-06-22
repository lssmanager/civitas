const {
  ORGANIZATION_ADMIN_ROLE_NAME,
  JIT_DEFAULT_ORGANIZATION_ROLE_NAME,
  replaceJitDefaultRolesForLogtoOrganization,
  replaceJitEmailDomainsForLogtoOrganization,
  addUserToLogtoOrganization,
  assignOrganizationRoleToUser,
  createLogtoOrganization,
  updateLogtoOrganizationCustomData,
  ensureOrganizationTemplate,
  findLogtoOrganizationByName,
  findOrganizationRoleByName,
  getLogtoUserById,
  createOrResolveLogtoUserByEmail,
  enforceNoProhibitedGlobalRolesForOrganizationUser,
} = require("./logtoManagement");
const { AUDIT_ACTIONS, AUDIT_RESULTS, recordAuditLogBestEffort } = require("./auditLogs");
const { buildLogtoUserCreatePayload } = require("./organizationProvisioningPayloads");

const DEFAULT_JIT_ROLE_NAMES = [JIT_DEFAULT_ORGANIZATION_ROLE_NAME];

const emptyToNull = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const normalizeRoleNames = (value, fallback = DEFAULT_JIT_ROLE_NAMES) => {
  const input = Array.isArray(value) ? value : fallback;
  const roles = input.map((role) => (typeof role === "string" ? role.trim() : "")).filter(Boolean);
  return Array.from(new Set(roles.length > 0 ? roles : fallback));
};
const normalizeAdministrativeContacts = (value, institutionalDomain = null) => {
  if (!Array.isArray(value)) return [];
  const suffix = institutionalDomain ? `@${String(institutionalDomain).trim().toLowerCase()}` : null;
  const normalizeContactEmail = (email) => {
    const normalized = emptyToNull(email)?.toLowerCase() || null;
    if (!normalized) return null;
    if (suffix && normalized === suffix) return null;
    return normalized;
  };
  return value
    .map((contact, index) => {
      const primerNombre = emptyToNull(contact?.firstName) || emptyToNull(contact?.primerNombre);
      const segundoNombre = emptyToNull(contact?.middleName) || emptyToNull(contact?.segundoNombre);
      const primerApellido = emptyToNull(contact?.firstSurname) || emptyToNull(contact?.primerApellido) || emptyToNull(contact?.lastName);
      const segundoApellido = emptyToNull(contact?.secondSurname) || emptyToNull(contact?.segundoApellido);
      const firstName = [primerNombre, segundoNombre].filter(Boolean).join(" ") || null;
      const lastName = [primerApellido, segundoApellido].filter(Boolean).join(" ") || null;
      return {
      key: typeof (contact?.key ?? contact?.kind) === "string" && (contact.key ?? contact.kind).trim() ? (contact.key ?? contact.kind).trim() : `administrative_contact_${index + 1}`,
      primerNombre,
      segundoNombre,
      primerApellido,
      segundoApellido,
      firstName: primerNombre,
      middleName: segundoNombre,
      firstSurname: primerApellido,
      secondSurname: segundoApellido,
      lastName,
      name: emptyToNull(contact?.name) || [primerNombre, segundoNombre, primerApellido, segundoApellido].filter(Boolean).join(" ") || [firstName, lastName].filter(Boolean).join(" ") || null,
      email: normalizeContactEmail(contact?.email),
      rawEmail: emptyToNull(contact?.email)?.toLowerCase() || null,
      phone: emptyToNull(contact?.phone),
      rawPhone: emptyToNull(contact?.phone),
      phoneExtension: emptyToNull(contact?.phoneExtension ?? contact?.extension),
      position: emptyToNull(contact?.position ?? contact?.cargo),
      organizationRoleName: emptyToNull(contact?.organizationRoleName),
      username: emptyToNull(contact?.username) || buildLogtoUsername({ email: normalizeContactEmail(contact?.email) }),
    };
    })
    .filter((contact) => contact.name || contact.email || contact.phone || contact.position);
};
const looksLikeRoleName = (value) => typeof value === "string" && value.trim().length > 0;
function normalizeUsernameSeed(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^([^a-z_])/, "_$1")
    .replace(/^_+$/, "");
}

function buildLogtoUsername({ email }) {
  const localPart = String(email || "").split("@")[0] || "";
  return normalizeUsernameSeed(localPart) || null;
}

const normalizePhoneE164 = (value) => {
  const raw = emptyToNull(value);
  if (!raw) return null;
  const compact = raw.replace(/[\s().-]+/g, "");
  if (!/^\+?[1-9]\d{6,14}$/.test(compact)) return null;
  return compact.startsWith("+") ? compact : `+${compact}`;
};

function getAdministrativeContactUniquenessErrors(administrativeContacts = []) {
  const byEmail = new Map();
  const errors = [];
  for (const [index, contact] of administrativeContacts.entries()) {
    if (!contact.email) continue;
    const previous = byEmail.get(contact.email);
    if (!previous) {
      byEmail.set(contact.email, { contact, index });
      continue;
    }
    const differingFields = [
      ["name", previous.contact.name, contact.name],
      ["position", previous.contact.position, contact.position],
      ["organizationRoleName", previous.contact.organizationRoleName, contact.organizationRoleName],
    ].filter(([, left, right]) => String(left || "") !== String(right || "")).map(([field]) => field);
    errors.push({
      field: `administrativeContacts.${index}.email`,
      message: differingFields.length
        ? `Administrative contacts must use unique emails. ${contact.email} is repeated with different ${differingFields.join(", ")}; create one contact per email before submitting.`
        : `Administrative contacts must use unique emails. ${contact.email} is repeated; remove the duplicate contact before submitting.`,
      code: "ADMINISTRATIVE_CONTACT_DUPLICATE_EMAIL",
      email: contact.email,
      duplicateOf: `administrativeContacts.${previous.index}.email`,
      differingFields,
    });
  }
  return errors;
}


const getLogtoOrganizationId = (organization) => organization.id || organization.organizationId || organization.logtoOrganizationId;
const getOrganizationRoleId = (role = {}) => role.id || role.organizationRoleId || role.roleId || null;
const getLogtoUserEmail = (user = {}) => user.primaryEmail || user.email || user.profile?.email || null;
const getLogtoUserId = (user = {}) => user.id || user.userId || user.logtoUserId || null;

function normalizeCanonicalProvisioningInput(body = {}) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  // Legacy member seed input is intentionally ignored. Organization creation only provisions the organization and metadata.
  const jitProvisioning = body.jitProvisioning && typeof body.jitProvisioning === "object" ? body.jitProvisioning : {};
  const jitProvisioningDomain = emptyToNull(jitProvisioning.domain ?? body.adminDomain ?? body.institutionalProvisioningDomain)?.toLowerCase() || null;
  const jitDefaultRoleNames = normalizeRoleNames(jitProvisioning.defaultRoleNames ?? body.defaultRoleNames, DEFAULT_JIT_ROLE_NAMES);
  const administrativeContacts = normalizeAdministrativeContacts(body.administrativeContacts, jitProvisioningDomain).map((contact) => ({ ...contact, phone: normalizePhoneE164(contact.phone) || contact.phone }));
  const errors = [];

  if (!name) errors.push({ field: "name", message: "Organization name is required" });
  if (!jitProvisioningDomain) errors.push({ field: "jitProvisioning.domain", message: "JIT provisioning domain is required" });
  if (!jitDefaultRoleNames.includes(JIT_DEFAULT_ORGANIZATION_ROLE_NAME)) errors.push({ field: "jitProvisioning.defaultRoleNames", message: `JIT default organization roles must include ${JIT_DEFAULT_ORGANIZATION_ROLE_NAME}` });
  administrativeContacts.forEach((contact, index) => {
    const prefix = `administrativeContacts.${index}`;
    if (!contact.name) errors.push({ field: `${prefix}.name`, message: "Administrative contact name is required when adding a contact" });
    if (!contact.email) errors.push({ field: `${prefix}.email`, message: "Administrative contact email is required and must include a local part before the institutional suffix" });
    if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) errors.push({ field: `${prefix}.email`, message: "Administrative contact email must be a valid email address" });
    if (contact.rawPhone && !normalizePhoneE164(contact.rawPhone)) errors.push({ field: `${prefix}.phone`, message: "Administrative contact phone must include country calling code and a valid national number" });
    if (!contact.organizationRoleName) errors.push({ field: `${prefix}.organizationRoleName`, message: "Administrative contact organization role is required" });
  });
  errors.push(...getAdministrativeContactUniquenessErrors(administrativeContacts));

  return {
    errors,
    value: {
      name,
      description: typeof body.description === "string" ? body.description.trim() : undefined,
      baseAdmin: null,
      jitProvisioning: { domain: jitProvisioningDomain, defaultRoleNames: jitDefaultRoleNames },
      administrativeContacts,
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

async function resolveAdministrativeContactUser({ contact, logtoOrganizationId, internalUser }) {
  const resolved = await createOrResolveLogtoUserByEmail(buildLogtoUserCreatePayload(contact));
  await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: resolved.created ? "administrative_contact_user_created" : "administrative_contact_user_resolved", administrativeContactEmail: contact.email, administrativeContactKey: contact.key, phone: contact.phone, position: contact.position, roleName: contact.organizationRoleName, source: resolved.source } });
  return resolved;
}

async function resolveBaseAdminUser({ canonical, logtoOrganizationId, internalUser }) {
  if (canonical.baseAdmin.logtoUserId) {
    const user = await getLogtoUserById(canonical.baseAdmin.logtoUserId);
    return { user, created: false, source: "provided_logto_user_id" };
  }

  const resolved = await createOrResolveLogtoUserByEmail(buildLogtoUserCreatePayload(canonical.baseAdmin));
  await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: resolved.created ? "base_admin_user_created" : "base_admin_user_resolved", baseAdminEmail: canonical.baseAdmin.email, source: resolved.source } });
  return resolved;
}

async function validateRequiredOrganizationRoles(roleNames, logtoOrganizationId, internalUser) {
  const template = await ensureOrganizationTemplate({ requiredRoleNames: roleNames });
  await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_TEMPLATE_VALIDATE, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "template_validated", requiredRoleNames: roleNames, availableRoleNames: template.roles.map((role) => role.name).filter(Boolean) } });
  return template;
}

async function validateBaseAdminGlobalRoles({ baseAdminLogtoUserId, baseAdminUserCreated, baseAdminUserSource, logtoOrganizationId, internalUser, auditContextBuilder, logtoOrganization }) {
  try {
    const result = await enforceNoProhibitedGlobalRolesForOrganizationUser({
      userId: baseAdminLogtoUserId,
      removeProhibitedRoles: Boolean(baseAdminUserCreated),
      existingUser: !baseAdminUserCreated,
    });
    await recordAuditLogBestEffort({
      actorUserId: internalUser.id,
      organizationId: logtoOrganizationId,
      action: AUDIT_ACTIONS.OWNER_ORGANIZATION_BASE_GLOBAL_ROLES,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: {
        ...auditContextBuilder({ organization: logtoOrganization }),
        stage: "base_global_roles_validated",
        baseAdminLogtoUserId,
        allowedGlobalRoleNames: result.allowedRoleNames,
        globalRoleNames: result.globalRoles.map((role) => role.name).filter(Boolean),
        baseAdminUserCreated: Boolean(baseAdminUserCreated),
        baseAdminUserSource,
      },
    });
    return result;
  } catch (error) {
    await recordAuditLogBestEffort({
      actorUserId: internalUser.id,
      organizationId: logtoOrganizationId,
      action: AUDIT_ACTIONS.OWNER_ORGANIZATION_BASE_GLOBAL_ROLES,
      result: AUDIT_RESULTS.ERROR,
      metadata: {
        ...auditContextBuilder({ organization: logtoOrganization }),
        stage: "base_global_roles_rejected",
        baseAdminLogtoUserId,
        code: error.code,
        prohibitedRoleNames: error.prohibitedRoles?.map((role) => role.name).filter(Boolean),
        removedRoleNames: error.removedRoles?.map((role) => role.name).filter(Boolean),
        unremovableRoleNames: error.unremovableRoles?.map((role) => role.name).filter(Boolean),
        retainedRoleNames: error.body?.retainedRoleNames,
        baseAdminUserCreated: Boolean(baseAdminUserCreated),
        baseAdminUserSource,
        diagnostic: error.diagnostic,
      },
    });
    throw error;
  }
}

async function assignBaseAdminBestEffort({ canonical, logtoOrganization, logtoOrganizationId, internalUser, auditContextBuilder }) {
  const resolvedUser = await resolveBaseAdminUser({ canonical, logtoOrganizationId, internalUser });
  const baseAdminLogtoUser = resolvedUser.user;
  const baseAdminLogtoUserId = getLogtoUserId(baseAdminLogtoUser);
  if (!baseAdminLogtoUserId) throw new Error("Base admin user resolution did not return a Logto user id");
  const logtoUserEmail = getLogtoUserEmail(baseAdminLogtoUser)?.toLowerCase() || null;
  if (logtoUserEmail !== canonical.baseAdmin.email) {
    const error = new Error("Base admin Logto user email does not match the requested base admin email");
    error.code = "BASE_ADMIN_EMAIL_MISMATCH";
    error.status = 409;
    error.diagnostic = "The resolved base admin Logto user belongs to a different email than baseAdmin.email; admin assignment was stopped.";
    throw error;
  }

  await validateBaseAdminGlobalRoles({
    baseAdminLogtoUserId,
    baseAdminUserCreated: Boolean(resolvedUser.created),
    baseAdminUserSource: resolvedUser.source,
    logtoOrganizationId,
    internalUser,
    auditContextBuilder,
    logtoOrganization,
  });

  const adminRole = await findOrganizationRoleByName(canonical.baseAdmin.initialOrganizationRole);
  const adminRoleId = getOrganizationRoleId(adminRole);
  if (!adminRoleId) throw new Error(`Logto organization role ${canonical.baseAdmin.initialOrganizationRole} exists but no role id was returned`);

  await addUserToLogtoOrganization({ organizationId: logtoOrganizationId, userId: baseAdminLogtoUserId });
  await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_BASE_MEMBER, result: AUDIT_RESULTS.SUCCESS, metadata: { ...auditContextBuilder({ organization: logtoOrganization }), stage: "base_member_added", baseAdminLogtoUserId } });

  await assignOrganizationRoleToUser({ organizationId: logtoOrganizationId, userId: baseAdminLogtoUserId, organizationRoleId: adminRoleId, organizationRoleName: canonical.baseAdmin.initialOrganizationRole });
  await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_BASE_ROLE, result: AUDIT_RESULTS.SUCCESS, metadata: { ...auditContextBuilder({ organization: logtoOrganization }), stage: "base_role_assigned", roleName: canonical.baseAdmin.initialOrganizationRole, roleId: adminRoleId, baseAdminLogtoUserId } });

  return { status: "assigned", userCreated: Boolean(resolvedUser.created), userSource: resolvedUser.source, logtoUserId: baseAdminLogtoUserId, roleName: canonical.baseAdmin.initialOrganizationRole, membershipAdded: true, roleAssigned: true };
}

async function assignAdministrativeContactsBestEffort({ canonical, logtoOrganization, logtoOrganizationId, internalUser, auditContextBuilder }) {
  const assignments = [];
  for (const contact of canonical.administrativeContacts || []) {
    const resolvedUser = await resolveAdministrativeContactUser({ contact, logtoOrganizationId, internalUser });
    const logtoUserId = getLogtoUserId(resolvedUser.user);
    if (!logtoUserId) throw new Error(`Administrative contact ${contact.email} resolution did not return a Logto user id`);
    const logtoUserEmail = getLogtoUserEmail(resolvedUser.user)?.toLowerCase() || null;
    if (logtoUserEmail !== contact.email) {
      const error = new Error("Administrative contact Logto user email does not match the requested email");
      error.code = "ADMINISTRATIVE_CONTACT_EMAIL_MISMATCH";
      error.status = 409;
      error.diagnostic = "The resolved administrative Logto user belongs to a different email; assignment was stopped.";
      throw error;
    }

    await validateBaseAdminGlobalRoles({
      baseAdminLogtoUserId: logtoUserId,
      baseAdminUserCreated: Boolean(resolvedUser.created),
      baseAdminUserSource: resolvedUser.source,
      logtoOrganizationId,
      internalUser,
      auditContextBuilder,
      logtoOrganization,
    });

    const role = await findOrganizationRoleByName(contact.organizationRoleName);
    const roleId = getOrganizationRoleId(role);
    if (!roleId) throw new Error(`Logto organization role ${contact.organizationRoleName} exists but no role id was returned`);

    await addUserToLogtoOrganization({ organizationId: logtoOrganizationId, userId: logtoUserId });
    await assignOrganizationRoleToUser({ organizationId: logtoOrganizationId, userId: logtoUserId, organizationRoleId: roleId, organizationRoleName: contact.organizationRoleName });
    await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.SUCCESS, metadata: { ...auditContextBuilder({ organization: logtoOrganization }), stage: "administrative_contact_assigned", administrativeContactKey: contact.key, email: contact.email, logtoUserId, roleName: contact.organizationRoleName, roleId } });
    assignments.push({ ...contact, status: "assigned", userCreated: Boolean(resolvedUser.created), userSource: resolvedUser.source, logtoUserId, roleName: contact.organizationRoleName, membershipAdded: true, roleAssigned: true });
  }
  return assignments;
}

async function configureJitProvisioning({ canonical, logtoOrganizationId, internalUser }) {
  const roleIds = [];
  for (const roleName of canonical.jitProvisioning.defaultRoleNames) {
    const role = await findOrganizationRoleByName(roleName);
    const roleId = getOrganizationRoleId(role);
    if (!roleId) throw new Error(`Logto organization role ${roleName} exists but no role id was returned`);
    roleIds.push(roleId);
  }

  await replaceJitEmailDomainsForLogtoOrganization({ organizationId: logtoOrganizationId, emailDomains: [canonical.jitProvisioning.domain] });
  await replaceJitDefaultRolesForLogtoOrganization({ organizationId: logtoOrganizationId, organizationRoleIds: roleIds });
  await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "jit_provisioning_configured", domain: canonical.jitProvisioning.domain, defaultRoleNames: canonical.jitProvisioning.defaultRoleNames, defaultRoleIds: roleIds } });
  return { status: "configured", domainConfigured: true, defaultRolesConfigured: true, domain: canonical.jitProvisioning.domain, defaultRoleNames: canonical.jitProvisioning.defaultRoleNames, defaultRoleIds: roleIds };
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

    const requiredRoleNames = Array.from(new Set([...canonical.jitProvisioning.defaultRoleNames, ...(canonical.administrativeContacts || []).map((contact) => contact.organizationRoleName)]));
    await validateRequiredOrganizationRoles(requiredRoleNames, logtoOrganizationId, internalUser);
    const jitProvisioning = await configureJitProvisioning({ canonical, logtoOrganizationId, internalUser });
    const adminAssignment = null;
    const administrativeContactAssignments = await assignAdministrativeContactsBestEffort({ canonical, logtoOrganization, logtoOrganizationId, internalUser, auditContextBuilder });

    return {
      logtoOrganization,
      logtoOrganizationId,
      canonicalCreated: true,
      reconciled: resolvedLogtoOrganization.reconciled,
      customDataApplied: Boolean(resolvedLogtoOrganization.customDataApplied),
      adminAssignment,
      administrativeContactAssignments,
      jitProvisioning,
      status: "created_with_metadata_and_jit_configured",
    };
  } catch (error) {
    error.provisioningState = { logtoOrganization, logtoOrganizationId, canonicalCreated: Boolean(logtoOrganizationId) };
    throw error;
  }
}

async function resumeOrganizationBootstrap(options) {
  return runCanonicalOrganizationBootstrap(options);
}

module.exports = { buildLogtoUsername, getAdministrativeContactUniquenessErrors, normalizeCanonicalProvisioningInput, normalizePhoneE164, resumeOrganizationBootstrap, runCanonicalOrganizationBootstrap };
