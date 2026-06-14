const MANAGEMENT_TOKEN_SCOPE = "all";
const ORGANIZATION_ADMIN_ROLE_NAME = "organization_admin";

let tokenCache = null;

const getRequiredEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for Logto Management API`);
  }
  return value;
};

const normalizeEndpoint = (endpoint) => endpoint.replace(/\/$/, "");

async function fetchLogtoManagementApiAccessToken() {
  if (tokenCache?.expiresAt && Date.now() < tokenCache.expiresAt - 5 * 60 * 1000) {
    return tokenCache.token;
  }

  const clientId = getRequiredEnv("LOGTO_MANAGEMENT_API_APPLICATION_ID");
  const clientSecret = getRequiredEnv("LOGTO_MANAGEMENT_API_APPLICATION_SECRET");
  const response = await fetch(getRequiredEnv("LOGTO_MANAGEMENT_API_TOKEN_ENDPOINT"), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      resource: getRequiredEnv("LOGTO_MANAGEMENT_API_RESOURCE"),
      scope: MANAGEMENT_TOKEN_SCOPE,
    }).toString(),
  });

  const tokenResponse = await response.json().catch(() => ({}));

  if (!response.ok || !tokenResponse.access_token) {
    throw new Error(`Failed to obtain Logto Management API token: ${response.status} ${JSON.stringify(tokenResponse)}`);
  }

  tokenCache = {
    token: tokenResponse.access_token,
    expiresAt: Date.now() + (tokenResponse.expires_in || 3600) * 1000,
  };

  return tokenCache.token;
}

async function callLogtoManagementApi(path, options = {}) {
  const accessToken = await fetchLogtoManagementApiAccessToken();
  const endpoint = normalizeEndpoint(getRequiredEnv("LOGTO_ENDPOINT"));
  const response = await fetch(`${endpoint}/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Logto Management API request failed: ${response.status} ${body}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function createLogtoOrganization({ name, description }) {
  return callLogtoManagementApi("/organizations", {
    method: "POST",
    body: JSON.stringify({ name, description }),
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
  addUserToLogtoOrganization,
  assignOrganizationRoleToUser,
  createLogtoOrganization,
  fetchLogtoManagementApiAccessToken,
  findOrganizationRoleByName,
  listLogtoOrganizationRoles,
  listLogtoOrganizations,
};
