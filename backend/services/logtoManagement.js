const crypto = require("crypto");

const MANAGEMENT_TOKEN_SCOPE = "all";
const ORGANIZATION_ADMIN_ROLE_NAME = "Admin-org";
const JIT_DEFAULT_ORGANIZATION_ROLE_NAME = "Student-org";
const REQUIRED_ORGANIZATION_ROLE_NAMES = [ORGANIZATION_ADMIN_ROLE_NAME, JIT_DEFAULT_ORGANIZATION_ROLE_NAME];
const PROHIBITED_ORGANIZATION_USER_GLOBAL_ROLE_NAMES = ["owner_global"];
const SENSITIVE_KEY_PATTERN = /(authorization|password|secret|token|credential|cookie|client[_-]?secret|api[_-]?key)/i;

const { getTimeoutMs, withTimeout } = require("./timeouts");

let tokenCache = null;

const getLogtoTimeoutMs = () => getTimeoutMs("LOGTO_MANAGEMENT_TIMEOUT_MS", 8000);

function sanitizeForDiagnostics(value, depth = 0) {
  if (value == null) return value;
  if (depth > 4) return "[MaxDepth]";
  if (value instanceof Error) return { name: value.name, message: value.message, status: value.status, code: value.code };
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => sanitizeForDiagnostics(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, SENSITIVE_KEY_PATTERN.test(key) ? "[Redacted]" : sanitizeForDiagnostics(entry, depth + 1)]));
  }
  if (typeof value === "string") return value.length > 1000 ? `${value.slice(0, 1000)}…` : value;
  return value;
}

function sanitizePublicPath(path) {
  if (typeof path !== "string" || !path) return null;
  try {
    return new URL(path, "https://civitas.invalid").pathname || "/";
  } catch (error) {
    return path.split("?")[0] || null;
  }
}

function sanitizePublicRequest(request) {
  if (!request || typeof request !== "object") return null;
  return {
    method: request.method || "GET",
    path: sanitizePublicPath(request.path || null),
  };
}

function sanitizeValidationDetails(value, depth = 0) {
  if (value == null) return value;
  if (depth > 3) return "[MaxDepth]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValidationDetails(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
      .map(([key, entry]) => [key, sanitizeValidationDetails(entry, depth + 1)]));
  }
  if (typeof value === "string") return value.length > 240 ? `${value.slice(0, 240)}…` : value;
  return value;
}

function sanitizePublicErrorBody(body) {
  if (!body || typeof body !== "object") return null;
  const sanitized = {};
  if (typeof body.reason === "string" && body.reason) sanitized.reason = body.reason;
  if (typeof body.message === "string" && body.message) sanitized.message = body.message.slice(0, 240);
  if (typeof body.code === "string" && body.code) sanitized.code = body.code;
  if (typeof body.status === "string" || Number.isInteger(body.status)) sanitized.status = body.status;
  if (Number.isInteger(body.timeoutMs)) sanitized.timeoutMs = body.timeoutMs;
  if (Array.isArray(body.missingRoleNames) && body.missingRoleNames.length > 0) sanitized.missingRoleNames = body.missingRoleNames.slice(0, 20);
  for (const key of ["availableRoleNames", "requiredRoleNames", "prohibitedRoleNames", "removedRoleNames", "retainedRoleNames", "unremovableRoleNames"]) {
    if (Array.isArray(body[key])) sanitized[key] = body[key].slice(0, 20);
  }
  if (typeof body.existingUser === "boolean") sanitized.existingUser = body.existingUser;
  if (typeof body.userId === "string") sanitized.userId = body.userId;
  for (const key of ["issues", "errors", "details", "data"]) {
    if (body[key] !== undefined) sanitized[key] = sanitizeValidationDetails(body[key]);
  }
  return Object.keys(sanitized).length ? sanitized : null;
}

class LogtoManagementApiError extends Error {
  constructor(message, { status, body, request, diagnostic } = {}) {
    super(message);
    this.name = "LogtoManagementApiError";
    this.status = status;
    this.body = sanitizePublicErrorBody(body);
    this.request = sanitizePublicRequest(request);
    this.diagnostic = null;
    this.internalBody = sanitizeForDiagnostics(body);
    this.internalRequest = request ? sanitizeForDiagnostics(request) : null;
    this.internalDiagnostic = diagnostic || null;
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
    error.internalDiagnostic = `Missing environment variable ${name}; configure Logto Management API credentials before calling Civitas owner organization endpoints.`;
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
  let response;
  try {
    response = await withTimeout((signal) => fetch(config.tokenEndpoint, {
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
    signal,
  }), { timeoutMs: getLogtoTimeoutMs(), label: "Logto Management API token request" });
  } catch (error) {
    if (error.code === "INTEGRATION_TIMEOUT") {
      const timeoutError = new LogtoManagementApiError("Logto Management API token request timed out", { status: 504, body: { reason: "logto_management_token_timeout", timeoutMs: error.timeoutMs } });
      timeoutError.code = "LOGTO_MANAGEMENT_TOKEN_TIMEOUT";
      timeoutError.internalDiagnostic = `Network timeout while requesting Logto M2M token after ${error.timeoutMs}ms.`;
      timeoutError.diagnostic = timeoutError.internalDiagnostic;
      throw timeoutError;
    }
    throw error;
  }

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
  let response;
  try {
    response = await withTimeout((signal) => fetch(`${endpoint}/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
    signal,
  }), { timeoutMs: getLogtoTimeoutMs(), label: `Logto Management API ${request.method} ${path}` });
  } catch (error) {
    if (error.code === "INTEGRATION_TIMEOUT") {
      const timeoutError = new LogtoManagementApiError("Logto Management API request timed out", { status: 504, body: { reason: "logto_management_request_timeout", timeoutMs: error.timeoutMs }, request });
      timeoutError.code = "LOGTO_MANAGEMENT_REQUEST_TIMEOUT";
      timeoutError.internalDiagnostic = `Network timeout while calling Logto Management API ${request.method} ${path} after ${error.timeoutMs}ms.`;
      timeoutError.diagnostic = timeoutError.internalDiagnostic;
      throw timeoutError;
    }
    throw error;
  }

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


function normalizeLogtoPrimaryPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits || undefined;
}

async function updateLogtoUser({ userId, email, primaryEmail, name, phone, primaryPhone, username, profile, customData }) {
  return callLogtoManagementApi(`/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      primaryEmail: primaryEmail || email || undefined,
      name: name || undefined,
      primaryPhone: normalizeLogtoPrimaryPhone(primaryPhone || phone),
      username: username || undefined,
      profile: profile && Object.keys(profile).length ? profile : undefined,
      customData: customData && Object.keys(customData).length ? customData : undefined,
    }),
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
  error.internalDiagnostic = existingUser
    ? "An existing Logto user has global roles incompatible with being an organization base admin. Civitas did not mutate the existing user; choose a different base admin or remove the incompatible global roles manually after verifying ownership."
    : "Logto assigned a global role to a newly created organization user. Civitas attempted to remove unsafe default global roles; remove default global roles for regular users because owner_global must be reserved for Civitas platform owners.";
  error.diagnostic = error.internalDiagnostic;
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

const getLogtoUserId = (user = {}) => user.id || user.userId || user.logtoUserId || null;
const getLogtoUserEmail = (user = {}) => (user.primaryEmail || user.email || user.profile?.email || "").toLowerCase() || null;
const getLogtoUserPhone = (user = {}) => normalizeLogtoPrimaryPhone(user.primaryPhone || user.phone || user.profile?.phoneNumber || user.profile?.phone_number || "") || null;
const getLogtoUsername = (user = {}) => user.username || user.profile?.preferredUsername || null;

async function findLogtoUserByEmail(email) {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!normalizedEmail) return null;
  const users = await listLogtoUsers({ search: normalizedEmail });
  return users.find((user) => getLogtoUserEmail(user) === normalizedEmail) || null;
}

async function findLogtoUserByPhone(phone) {
  const normalizedPhone = normalizeLogtoPrimaryPhone(phone);
  if (!normalizedPhone) return null;
  const users = await listLogtoUsers({ search: normalizedPhone });
  return users.find((user) => getLogtoUserPhone(user) === normalizedPhone) || null;
}

async function findLogtoUserByUsername(username) {
  const normalizedUsername = typeof username === "string" ? username.trim() : "";
  if (!normalizedUsername) return null;
  const users = await listLogtoUsers({ search: normalizedUsername });
  return users.find((user) => getLogtoUsername(user) === normalizedUsername) || null;
}

function logtoValidationMentions(error, field) {
  const haystack = JSON.stringify(error?.internalBody || error?.body || {}).toLowerCase();
  return haystack.includes(String(field).toLowerCase());
}

async function createLogtoUser({ email, primaryEmail, name, phone, primaryPhone, username, profile, customData }) {
  return callLogtoManagementApi("/users", {
    method: "POST",
    body: JSON.stringify({
      primaryEmail: primaryEmail || email,
      name,
      username: username || undefined,
      ...(normalizeLogtoPrimaryPhone(primaryPhone || phone) ? { primaryPhone: normalizeLogtoPrimaryPhone(primaryPhone || phone) } : {}),
      profile: profile && Object.keys(profile).length ? profile : undefined,
      customData: customData && Object.keys(customData).length ? customData : undefined,
    }),
  });
}

async function createOrResolveLogtoUserByEmail({ email, primaryEmail, name, phone, primaryPhone, username, profile, customData }) {
  email = primaryEmail || email;
  phone = primaryPhone || phone;
  const normalizedPhone = normalizeLogtoPrimaryPhone(phone);
  const existingUser = await findLogtoUserByEmail(email);
  if (existingUser) {
    const userId = getLogtoUserId(existingUser);
    // Preserve Logto as identity canonical: update only the email-owned user and omit
    // unique fields already held by another Logto user instead of creating local mirrors.
    const phoneOwner = normalizedPhone ? await findLogtoUserByPhone(normalizedPhone) : null;
    const phoneConflict = phoneOwner && getLogtoUserId(phoneOwner) !== userId;
    if (userId && (name || phone || username || profile || customData)) {
      const updated = await updateLogtoUser({ userId, email, name, phone: phoneConflict ? null : phone, username, profile, customData });
      return { user: updated || existingUser, created: false, source: phoneConflict ? "email_lookup_updated_phone_omitted" : "email_lookup_updated", reconciliation: phoneConflict ? { omittedFields: ["primaryPhone"], reason: "primary_phone_belongs_to_different_logto_user", conflictingUserId: getLogtoUserId(phoneOwner) } : undefined };
    }
    return { user: existingUser, created: false, source: "email_lookup" };
  }

  const phoneOwner = normalizedPhone ? await findLogtoUserByPhone(normalizedPhone) : null;
  const phoneConflict = phoneOwner && getLogtoUserEmail(phoneOwner) !== String(email || "").toLowerCase();
  const basePayload = { email, name, phone: phoneConflict ? null : phone, username, profile, customData };
  const baseReconciliation = phoneConflict ? { omittedFields: ["primaryPhone"], reason: "primary_phone_belongs_to_different_logto_user", conflictingUserId: getLogtoUserId(phoneOwner) } : undefined;

  try {
    return { user: await createLogtoUser(basePayload), created: true, source: phoneConflict ? "create_user_phone_omitted" : "create_user", reconciliation: baseReconciliation };
  } catch (error) {
    if (error instanceof LogtoManagementApiError && [400, 409, 422].includes(error.status)) {
      const reconciledUser = await findLogtoUserByEmail(email);
      if (reconciledUser) return { user: reconciledUser, created: false, source: "post_create_email_lookup" };
      if (normalizedPhone && !phoneConflict && logtoValidationMentions(error, "phone")) {
        const retryPhoneOwner = await findLogtoUserByPhone(normalizedPhone);
        const retryReconciliation = { omittedFields: ["primaryPhone"], reason: "primary_phone_rejected_by_logto_validation", conflictingUserId: getLogtoUserId(retryPhoneOwner) };
        return { user: await createLogtoUser({ email, name, username, profile, customData }), created: true, source: "create_user_after_phone_validation_omitted", reconciliation: retryReconciliation };
      }
      if (username) {
        for (let suffix = 1; suffix <= 20; suffix += 1) {
          try {
            const fallbackUsername = `${username}${suffix}`;
            return { user: await createLogtoUser({ ...basePayload, username: fallbackUsername, profile: { ...(profile || {}), preferredUsername: fallbackUsername } }), created: true, source: "create_user_username_suffix", username: fallbackUsername, reconciliation: baseReconciliation };
          } catch (retryError) {
            if (!(retryError instanceof LogtoManagementApiError) || ![400, 409, 422].includes(retryError.status)) throw retryError;
          }
        }
      }
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
  findLogtoUserByPhone,
  findLogtoUserByUsername,
  listLogtoOrganizationRoles,
  listLogtoOrganizationUsers,
  listLogtoOrganizationUserRoles,
  listLogtoUsers,
  validateOrganizationTemplate,
  parseLogtoManagementApiResponse,
  listLogtoOrganizations,
};