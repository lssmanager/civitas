const crypto = require("crypto");

const MANAGEMENT_TOKEN_SCOPE = "all";
const ORGANIZATION_ADMIN_ROLE_NAME = "Admin-org";
const JIT_DEFAULT_ORGANIZATION_ROLE_NAME = "Student-org";
const REQUIRED_ORGANIZATION_ROLE_NAMES = [ORGANIZATION_ADMIN_ROLE_NAME, JIT_DEFAULT_ORGANIZATION_ROLE_NAME];
const PROHIBITED_ORGANIZATION_USER_GLOBAL_ROLE_NAMES = ["owner_global"];

let tokenCache = null;

class LogtoManagementApiError extends Error {
  constructor(message, { status, body, request } = {}) {
    super(message);
    this.name = "LogtoManagementApiError";
    this.status = status;
    this.body = body;
    this.request = request;
  }
}

const getRequiredEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    const error = new LogtoManagementApiError(`${name} is required for Logto Management API`, {
      status: 500,
      body: { reason: "missing_logto_management_configuration", env: name },
    });
    error.code = "LOGTO_MANAGEMENT_CONFIG_MISSING";
    error.diagnostic = `Missing environment variable ${name}; configure Logto Management API credentials before calling Civitas owner organization endpoints.`;
    throw error;
  }
  return value;
};

const normalizeEndpoint = (endpoint) => endpoint.replace(/\/$/, "");

const getLogtoManagementConfig = () => ({
  endpoint: normalizeEndpoint(getRequiredEnv("LOGTO_ENDPOINT")),
  tokenEndpoint: getRequiredEnv("LOGTO_MANAGEMENT_API_TOKEN_ENDPOINT"),
  clientId: getRequiredEnv("LOGTO_MANAGEMENT_API_APPLICATION_ID"),
  clientSecret: getRequiredEnv("LOGTO_MANAGEMENT_API_APPLICATION_SECRET"),
  resource: getRequiredEnv("LOGTO_MANAGEMENT_API_RESOURCE"),
});

async function fetchLogtoManagementApiAccessToken() {
  if (tokenCache?.expiresAt && Date.now() < tokenCache.expiresAt - 5 * 60 * 1000) {
    return tokenCache.token;
  }

  const config = getLogtoManagementConfig();
  const response = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      resource: config.resource,
      scope: MANAGEMENT_TOKEN_SCOPE,
    }).toString(),
  });

  const tokenResponse = await response.json().catch(() => ({}));

  if (!response.ok || !tokenResponse.access_token) {
    throw new LogtoManagementApiError("Failed to obtain Logto Management API token", {
      status: response.status,
      body: tokenResponse,
    });
  }

  tokenCache = {
    token: tokenResponse.access_token,
    expiresAt: Date.now() + (tokenResponse.expires_in || 3600) * 1000,
  };

  return tokenCache.token;
}

async function parseLogtoManagementApiResponse(response) {
  if (response.status === 204) {
    return null;
  }

  const body = await response.text();
  if (!body) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(body);
    } catch (error) {
      throw new LogtoManagementApiError("Logto Management API returned invalid JSON", {
        status: response.status,
        body,
      });
    }
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    return {
      status: response.status,
      contentType,
      rawBody: body,
    };
  }
}

const parseRequestBodyForDiagnostics = (body) => {
  if (!body) return undefined;
  if (typeof body !== "string") return "[non-string body]";
  try {
    return JSON.parse(body);
  } catch (error) {
    return body;
  }
};

async function callLogtoManagementApi(path, options = {}) {
  const accessToken = await fetchLogtoManagementApiAccessToken();
  const { endpoint } = getLogtoManagementConfig();
  const request = { method: options.method || "GET", path, payload: parseRequestBodyForDiagnostics(options.body) };
  const response = await fetch(`${endpoint}/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
  });

  const parsedBody = await parseLogtoManagementApiResponse(response);

  if (!response.ok) {
    throw new LogtoManagementApiError("Logto Management API request failed", { status: response.status, body: parsedBody, request });
  }

  return parsedBody;
}

async function createLogtoOrganization({ name, description, customData }) {
  return callLogtoManagementApi("/organizations", {
    method: "POST",
    body: JSON.stringify({ name, description: description || undefined, customData: customData || undefined }),
  });
}

async function updateLogtoOrganizationCustomData({ organizationId, customData }) {
  return callLogtoManagementApi(`/organizations/${organizationId}`, {
    method: "PATCH",
    body: JSON.stringify({ customData }),
  });
}

async function updateLogtoOrganization({ organizationId, name, description, customData }) {
  return callLogtoManagementApi(`/organizations/${encodeURIComponent(organizationId)}`, {
    method: "PATCH",
    body: JSON.stringify({ name: name || undefined, description: description || undefined, customData: customData || undefined }),
  });
}

async function getLogtoOrganizationById(organizationId) {
  return callLogtoManagementApi(`/organizations/${encodeURIComponent(organizationId)}`);
}

async function addUserToLogtoOrganization({ organizationId, userId }) {
  return callLogtoManagementApi(`/organizations/${organizationId}/users`, {
    method: "POST",
    body: JSON.stringify({ userIds: [userId] }),
  });
}

async function replaceJitEmailDomainsForLogtoOrganization({ organizationId, emailDomains }) {
  return callLogtoManagementApi(`/organizations/${organizationId}/jit/email-domains`, {
    method: "PUT",
    body: JSON.stringify({ emailDomains }),
  });
}

async function replaceJitDefaultRolesForLogtoOrganization({ organizationId, organizationRoleIds }) {
  return callLogtoManagementApi(`/organizations/${organizationId}/jit/roles`, {
    method: "PUT",
    body: JSON.stringify({ organizationRoleIds }),
  });
}

async function listLogtoOrganizationRoles() {
  const response = await callLogtoManagementApi("/organization-roles");
  return normalizeRoleListResponse(response);
}

const getOrganizationRoleName = (role = {}) => role.name || role.nameCache || role.key || null;
const getOrganizationRoleId = (role = {}) => role.id || role.organizationRoleId || role.roleId || null;
const getGlobalRoleName = (role = {}) => role.name || role.nameCache || role.key || null;
const getGlobalRoleId = (role = {}) => role.id || role.roleId || null;

const parseCommaSeparatedEnv = (name) => (process.env[name] || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function getAllowedOrganizationUserGlobalRoleNames() {
  return parseCommaSeparatedEnv("CIVITAS_ALLOWED_ORG_USER_GLOBAL_ROLES");
}

const normalizeRoleListResponse = (response) => (Array.isArray(response) ? response : response?.data || response?.items || []);

async function findOrganizationRoleByName(name) {
  const roles = await listLogtoOrganizationRoles();
  return roles.find((role) => getOrganizationRoleName(role) === name) || null;
}

async function validateOrganizationTemplate({ requiredRoleNames = REQUIRED_ORGANIZATION_ROLE_NAMES } = {}) {
  const roles = await listLogtoOrganizationRoles();
  const normalizedRoles = roles.map((role) => ({
    ...role,
    id: getOrganizationRoleId(role),
    name: getOrganizationRoleName(role),
  }));
  const availableRoleNames = normalizedRoles.map((role) => role.name).filter(Boolean);
  const missingRoleNames = requiredRoleNames.filter((roleName) => !availableRoleNames.includes(roleName));

  return {
    ok: missingRoleNames.length === 0,
    requiredRoleNames,
    missingRoleNames,
    roles: normalizedRoles,
  };
}

// Civitas validates organization-template roles before creating a Logto organization.
// We intentionally fail fast instead of auto-mutating the template, because template
// roles are tenant-wide security configuration managed in Logto Console/Management API.
async function ensureOrganizationTemplate({ requiredRoleNames = REQUIRED_ORGANIZATION_ROLE_NAMES } = {}) {
  const template = await validateOrganizationTemplate({ requiredRoleNames });
  if (!template.ok) {
    const error = new LogtoManagementApiError(`Logto organization template is missing required role(s): ${template.missingRoleNames.join(", ")}`, {
      status: 424,
      body: {
        reason: "organization_template_missing_roles",
        requiredRoleNames: template.requiredRoleNames,
        missingRoleNames: template.missingRoleNames,
        availableRoleNames: template.roles.map((role) => role.name).filter(Boolean),
      },
    });
    error.code = "LOGTO_ORGANIZATION_TEMPLATE_MISSING_ROLES";
    error.missingRoleNames = template.missingRoleNames;
    throw error;
  }
  return template;
}

async function findLogtoOrganizationByName(name) {
  const normalizedName = typeof name === "string" ? name.trim() : "";
  if (!normalizedName) {
    return null;
  }

  const organizations = await listLogtoOrganizations();
  return organizations.find((organization) => organization?.name === normalizedName || organization?.nameCache === normalizedName) || null;
}

async function assignOrganizationRoleToUser({ organizationId, userId, organizationRoleId, organizationRoleName }) {
  const rolePayload = organizationRoleId
    ? { organizationRoleIds: [organizationRoleId] }
    : { organizationRoleNames: [organizationRoleName] };
  return callLogtoManagementApi(`/organizations/${organizationId}/users/${userId}/roles`, {
    method: "POST",
    body: JSON.stringify(rolePayload),
  });
}

async function getLogtoUserById(userId) {
  return callLogtoManagementApi(`/users/${encodeURIComponent(userId)}`);
}

async function updateLogtoUser({ userId, email, name, phone }) {
  return callLogtoManagementApi(`/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify({ primaryEmail: email || undefined, name: name || undefined, phone: phone || undefined }),
  });
}

async function createLogtoUserPasswordResetRequest({ userId }) {
  if (process.env.LOGTO_ENABLE_ADMIN_PASSWORD_RESET !== "true") {
    const error = new LogtoManagementApiError("Logto admin password reset is disabled for Civitas", {
      status: 501,
      body: {
        reason: "unsupported_safe_reset",
        logtoVersion: process.env.LOGTO_VERSION || "1.40.1",
        policy: "No local password reset is created. Use Logto hosted reset-password flow or explicitly enable admin password regeneration.",
      },
    });
    error.code = "LOGTO_UNSUPPORTED_CAPABILITY";
    throw error;
  }

  const generatedPassword = process.env.LOGTO_ADMIN_RESET_PASSWORD_VALUE || `Civitas-${crypto.randomUUID()}!`;
  const response = await callLogtoManagementApi(`/users/${encodeURIComponent(userId)}/password`, {
    method: "PATCH",
    body: JSON.stringify({ password: generatedPassword }),
  });
  return {
    status: "password_regenerated",
    delivery: "manual_secure_channel_required",
    passwordReturnedOnce: Boolean(process.env.LOGTO_ADMIN_RESET_PASSWORD_VALUE),
    response,
  };
}

async function listLogtoUsers({ search } = {}) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  const response = await callLogtoManagementApi(`/users${params.toString() ? `?${params}` : ""}`);
  return Array.isArray(response) ? response : response?.data || response?.items || [];
}

async function listLogtoOrganizationUsers({ organizationId }) {
  const response = await callLogtoManagementApi(`/organizations/${encodeURIComponent(organizationId)}/users`);
  return Array.isArray(response) ? response : response?.data || response?.items || [];
}

async function listLogtoOrganizationUserRoles({ organizationId, userId }) {
  const response = await callLogtoManagementApi(`/organizations/${encodeURIComponent(organizationId)}/users/${encodeURIComponent(userId)}/roles`);
  return normalizeRoleListResponse(response).map((role) => ({ ...role, id: getOrganizationRoleId(role), name: getOrganizationRoleName(role) }));
}

async function removeUserFromLogtoOrganization({ organizationId, userId }) {
  return callLogtoManagementApi(`/organizations/${encodeURIComponent(organizationId)}/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

async function listLogtoUserGlobalRoles({ userId }) {
  return normalizeRoleListResponse(await callLogtoManagementApi(`/users/${encodeURIComponent(userId)}/roles`))
    .map((role) => ({ ...role, id: getGlobalRoleId(role), name: getGlobalRoleName(role) }));
}

async function removeLogtoUserGlobalRole({ userId, roleId }) {
  return callLogtoManagementApi(`/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`, {
    method: "DELETE",
  });
}

async function removeProhibitedLogtoUserGlobalRoles({
  userId,
  allowedRoleNames = getAllowedOrganizationUserGlobalRoleNames(),
  removeProhibitedRoles = false,
} = {}) {
  const allowed = new Set(allowedRoleNames);
  const globalRoles = await listLogtoUserGlobalRoles({ userId });
  const prohibitedRoles = globalRoles.filter((role) => !allowed.has(role.name));
  const removedRoles = [];
  const unremovableRoles = [];
  const retainedRoles = [];

  if (!removeProhibitedRoles) {
    return { allowedRoleNames, globalRoles, prohibitedRoles, removedRoles, unremovableRoles, retainedRoles: prohibitedRoles };
  }

  for (const role of prohibitedRoles) {
    if (!role.id) {
      unremovableRoles.push(role);
      retainedRoles.push(role);
      continue;
    }
    await removeLogtoUserGlobalRole({ userId, roleId: role.id });
    removedRoles.push(role);
  }

  return { allowedRoleNames, globalRoles, prohibitedRoles, removedRoles, unremovableRoles, retainedRoles };
}

function buildProhibitedGlobalRolesError({ userId, prohibitedRoles, removedRoles = [], unremovableRoles = [], retainedRoles = [], existingUser = false }) {
  const prohibitedRoleNames = prohibitedRoles.map((role) => role.name).filter(Boolean);
  const error = new LogtoManagementApiError(`Organization user has prohibited global role(s): ${prohibitedRoleNames.join(", ") || "unknown"}`, {
    status: 424,
    body: {
      reason: "organization_user_prohibited_global_roles",
      userId,
      prohibitedRoleNames,
      removedRoleNames: removedRoles.map((role) => role.name).filter(Boolean),
      unremovableRoleNames: unremovableRoles.map((role) => role.name).filter(Boolean),
      retainedRoleNames: retainedRoles.map((role) => role.name).filter(Boolean),
      existingUser,
    },
  });
  error.code = "LOGTO_ORGANIZATION_USER_PROHIBITED_GLOBAL_ROLES";
  error.prohibitedRoles = prohibitedRoles;
  error.removedRoles = removedRoles;
  error.unremovableRoles = unremovableRoles;
  error.retainedRoles = retainedRoles;
  error.diagnostic = existingUser
    ? "An existing Logto user has global roles incompatible with being an organization base admin. Civitas did not mutate the existing user; choose a different base admin or remove the incompatible global roles manually after verifying ownership."
    : "Logto assigned a global role to a newly created organization user. Civitas attempted to remove unsafe default global roles; remove default global roles for regular users because owner_global must be reserved for Civitas platform owners.";
  return error;
}

async function enforceNoProhibitedGlobalRolesForOrganizationUser({
  userId,
  allowedRoleNames = getAllowedOrganizationUserGlobalRoleNames(),
  removeProhibitedRoles = false,
  existingUser = !removeProhibitedRoles,
} = {}) {
  const result = await removeProhibitedLogtoUserGlobalRoles({ userId, allowedRoleNames, removeProhibitedRoles });
  if (result.prohibitedRoles.length > 0) {
    throw buildProhibitedGlobalRolesError({ userId, existingUser, ...result });
  }
  return result;
}

async function findLogtoUserByEmail(email) {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!normalizedEmail) return null;
  const users = await listLogtoUsers({ search: normalizedEmail });
  return users.find((user) => (user.primaryEmail || user.email || user.profile?.email || "").toLowerCase() === normalizedEmail) || null;
}

async function createLogtoUser({ email, name, phone }) {
  return callLogtoManagementApi("/users", {
    method: "POST",
    body: JSON.stringify({ primaryEmail: email, name, ...(phone ? { primaryPhone: phone } : {}) }),
  });
}

async function createOrResolveLogtoUserByEmail({ email, name, phone }) {
  const existingUser = await findLogtoUserByEmail(email);
  if (existingUser) {
    const userId = existingUser.id || existingUser.userId || existingUser.logtoUserId;
    if (userId && (name || phone)) {
      const updated = await updateLogtoUser({ userId, email, name, phone });
      return { user: updated || existingUser, created: false, source: "email_lookup_updated" };
    }
    return { user: existingUser, created: false, source: "email_lookup" };
  }

  try {
    return { user: await createLogtoUser({ email, name, phone }), created: true, source: "create_user" };
  } catch (error) {
    if (error instanceof LogtoManagementApiError && [400, 409, 422].includes(error.status)) {
      const reconciledUser = await findLogtoUserByEmail(email);
      if (reconciledUser) return { user: reconciledUser, created: false, source: "post_create_email_lookup" };
    }
    throw error;
  }
}

async function listLogtoOrganizations() {
  const response = await callLogtoManagementApi("/organizations");
  return Array.isArray(response) ? response : response?.data || response?.items || [];
}

module.exports = {
  ORGANIZATION_ADMIN_ROLE_NAME,
  JIT_DEFAULT_ORGANIZATION_ROLE_NAME,
  REQUIRED_ORGANIZATION_ROLE_NAMES,
  PROHIBITED_ORGANIZATION_USER_GLOBAL_ROLE_NAMES,
  LogtoManagementApiError,
  replaceJitDefaultRolesForLogtoOrganization,
  replaceJitEmailDomainsForLogtoOrganization,
  addUserToLogtoOrganization,
  assignOrganizationRoleToUser,
  createLogtoOrganization,
  createLogtoUser,
  createOrResolveLogtoUserByEmail,
  enforceNoProhibitedGlobalRolesForOrganizationUser,
  getAllowedOrganizationUserGlobalRoleNames,
  listLogtoUserGlobalRoles,
  removeLogtoUserGlobalRole,
  removeUserFromLogtoOrganization,
  removeProhibitedLogtoUserGlobalRoles,
  updateLogtoOrganizationCustomData,
  updateLogtoOrganization,
  updateLogtoUser,
  createLogtoUserPasswordResetRequest,
  fetchLogtoManagementApiAccessToken,
  findLogtoOrganizationByName,
  ensureOrganizationTemplate,
  findOrganizationRoleByName,
  getLogtoManagementConfig,
  getLogtoUserById,
  getLogtoOrganizationById,
  findLogtoUserByEmail,
  listLogtoOrganizationRoles,
  listLogtoOrganizationUsers,
  listLogtoOrganizationUserRoles,
  listLogtoUsers,
  validateOrganizationTemplate,
  parseLogtoManagementApiResponse,
  listLogtoOrganizations,
};
