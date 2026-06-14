const MANAGEMENT_TOKEN_SCOPE = "all";
const ORGANIZATION_ADMIN_ROLE_NAME = "organization_admin";

let tokenCache = null;

class LogtoManagementApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "LogtoManagementApiError";
    this.status = status;
    this.body = body;
  }
}

const getRequiredEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for Logto Management API`);
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

async function callLogtoManagementApi(path, options = {}) {
  const accessToken = await fetchLogtoManagementApiAccessToken();
  const { endpoint } = getLogtoManagementConfig();
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
    throw new LogtoManagementApiError("Logto Management API request failed", { status: response.status, body: parsedBody });
  }

  return parsedBody;
}

async function createLogtoOrganization({ name, description }) {
  return callLogtoManagementApi("/organizations", {
    method: "POST",
    body: JSON.stringify({ name, description: description || undefined }),
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

async function findOrganizationRoleByName(name) {
  const roles = await listLogtoOrganizationRoles();
  return roles.find((role) => role.name === name) || null;
}

async function findLogtoOrganizationByName(name) {
  const normalizedName = typeof name === "string" ? name.trim() : "";
  if (!normalizedName) {
    return null;
  }

  const organizations = await listLogtoOrganizations();
  return organizations.find((organization) => organization?.name === normalizedName || organization?.nameCache === normalizedName) || null;
}

async function assignOrganizationRoleToUser({ organizationId, userId, organizationRoleId }) {
  return callLogtoManagementApi(`/organizations/${organizationId}/users/${userId}/roles`, {
    method: "POST",
    body: JSON.stringify({ organizationRoleIds: [organizationRoleId] }),
  });
}

async function listLogtoOrganizations() {
  const response = await callLogtoManagementApi("/organizations");
  return Array.isArray(response) ? response : response?.data || response?.items || [];
}

module.exports = {
  ORGANIZATION_ADMIN_ROLE_NAME,
  LogtoManagementApiError,
  addUserToLogtoOrganization,
  assignOrganizationRoleToUser,
  createLogtoOrganization,
  fetchLogtoManagementApiAccessToken,
  findLogtoOrganizationByName,
  findOrganizationRoleByName,
  getLogtoManagementConfig,
  listLogtoOrganizationRoles,
  parseLogtoManagementApiResponse,
  listLogtoOrganizations,
};
