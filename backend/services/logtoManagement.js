const MANAGEMENT_TOKEN_SCOPE = "all";
const ORGANIZATION_ADMIN_ROLE_NAME = "Admin-org";
const REQUIRED_ORGANIZATION_ROLE_NAMES = [ORGANIZATION_ADMIN_ROLE_NAME];

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

async function addUserToLogtoOrganization({ organizationId, userId }) {
  return callLogtoManagementApi(`/organizations/${organizationId}/users`, {
    method: "POST",
    body: JSON.stringify({ userIds: [userId] }),
  });
}

async function listLogtoOrganizationRoles() {
  const response = await callLogtoManagementApi("/organization-roles");
  return Array.isArray(response) ? response : response?.data || response?.items || [];
}

const getOrganizationRoleName = (role = {}) => role.name || role.nameCache || role.key || null;
const getOrganizationRoleId = (role = {}) => role.id || role.organizationRoleId || role.roleId || null;

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

async function listLogtoOrganizations() {
  const response = await callLogtoManagementApi("/organizations");
  return Array.isArray(response) ? response : response?.data || response?.items || [];
}

module.exports = {
  ORGANIZATION_ADMIN_ROLE_NAME,
  REQUIRED_ORGANIZATION_ROLE_NAMES,
  LogtoManagementApiError,
  addUserToLogtoOrganization,
  assignOrganizationRoleToUser,
  createLogtoOrganization,
  updateLogtoOrganizationCustomData,
  fetchLogtoManagementApiAccessToken,
  findLogtoOrganizationByName,
  ensureOrganizationTemplate,
  findOrganizationRoleByName,
  getLogtoManagementConfig,
  getLogtoUserById,
  listLogtoOrganizationRoles,
  validateOrganizationTemplate,
  parseLogtoManagementApiResponse,
  listLogtoOrganizations,
};
