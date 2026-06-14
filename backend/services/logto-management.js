const getRequiredEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for Logto Management API`);
  }
  return value;
};

const normalizeEndpoint = (endpoint) => endpoint.replace(/\/$/, "");

let cachedToken;

async function getManagementApiToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken?.accessToken && cachedToken.expiresAt > now + 30) {
    return cachedToken.accessToken;
  }

  const response = await fetch(getRequiredEnv("LOGTO_MANAGEMENT_API_TOKEN_ENDPOINT"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: getRequiredEnv("LOGTO_MANAGEMENT_API_APPLICATION_ID"),
      client_secret: getRequiredEnv("LOGTO_MANAGEMENT_API_APPLICATION_SECRET"),
      resource: getRequiredEnv("LOGTO_MANAGEMENT_API_RESOURCE"),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to obtain Logto Management API token: ${response.status} ${body}`);
  }

  const token = await response.json();
  cachedToken = {
    accessToken: token.access_token,
    expiresAt: now + (token.expires_in || 3600),
  };

  return cachedToken.accessToken;
}

async function callManagementApi(path, options = {}) {
  const accessToken = await getManagementApiToken();
  const endpoint = normalizeEndpoint(process.env.LOGTO_ENDPOINT || getRequiredEnv("LOGTO_ISSUER").replace(/\/oidc$/, ""));
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

async function listOrganizations() {
  return callManagementApi("/organizations");
}

async function createOrganization({ name, description }) {
  return callManagementApi("/organizations", {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });
}

module.exports = {
  createOrganization,
  listOrganizations,
};
