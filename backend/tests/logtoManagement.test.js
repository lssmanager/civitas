const assert = require("node:assert/strict");
const test = require("node:test");

process.env.LOGTO_ENDPOINT = "https://logto.example";
process.env.LOGTO_MANAGEMENT_API_TOKEN_ENDPOINT = "https://logto.example/oidc/token";
process.env.LOGTO_MANAGEMENT_API_APPLICATION_ID = "app";
process.env.LOGTO_MANAGEMENT_API_APPLICATION_SECRET = "secret";
process.env.LOGTO_MANAGEMENT_API_RESOURCE = "https://logto.example/api";
delete process.env.CIVITAS_ALLOWED_ORG_USER_GLOBAL_ROLES;

const {
  createLogtoUser,
  enforceNoProhibitedGlobalRolesForOrganizationUser,
  getAllowedOrganizationUserGlobalRoleNames,
} = require("../services/logtoManagement");

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

const noContentResponse = () => new Response(null, { status: 204 });

const installRoleFetchMock = ({ roles }) => {
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/api/users/user-1/roles")) return jsonResponse(roles);
    if (String(url).endsWith("/api/users/user-1/roles/role-owner")) return noContentResponse();
    throw new Error(`unexpected request: ${url}`);
  };
  return requests;
};

const assertOwnerGlobalRejection = async (options, expected) => {
  await assert.rejects(
    enforceNoProhibitedGlobalRolesForOrganizationUser({ userId: "user-1", ...options }),
    (error) => {
      assert.equal(error.code, "LOGTO_ORGANIZATION_USER_PROHIBITED_GLOBAL_ROLES");
      assert.deepEqual(error.body.prohibitedRoleNames, ["owner_global"]);
      assert.deepEqual(error.body.removedRoleNames, expected.removedRoleNames);
      assert.deepEqual(error.body.retainedRoleNames, expected.retainedRoleNames);
      assert.equal(error.body.existingUser, expected.existingUser);
      assert.match(error.diagnostic, expected.diagnosticPattern);
      return true;
    }
  );
};

test("createLogtoUser does not assign global roles", async () => {
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/oidc/token")) return jsonResponse({ access_token: "token", expires_in: 3600 });
    if (String(url).endsWith("/api/users")) return jsonResponse({ id: "user-1", primaryEmail: "admin@example.edu" });
    throw new Error(`unexpected request: ${url}`);
  };

  await createLogtoUser({ email: "admin@example.edu", name: "School Admin" });

  const createRequest = requests.find((request) => request.url.endsWith("/api/users"));
  const payload = JSON.parse(createRequest.options.body);
  assert.deepEqual(payload, { primaryEmail: "admin@example.edu", name: "School Admin" });
  assert.equal(Object.hasOwn(payload, "roleIds"), false);
  assert.equal(Object.hasOwn(payload, "roles"), false);
});

test("createLogtoUser sends Logto-compatible username and primary phone", async () => {
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/oidc/token")) return jsonResponse({ access_token: "token", expires_in: 3600 });
    if (String(url).endsWith("/api/users")) return jsonResponse({ id: "user-1", primaryEmail: "j.doe@example.edu" });
    throw new Error(`unexpected request: ${url}`);
  };

  await createLogtoUser({ email: "j.doe@example.edu", name: "Jane Doe", phone: "+57 300 111 2233", username: "j_doe" });

  const createRequest = requests.find((request) => request.url.endsWith("/api/users"));
  const payload = JSON.parse(createRequest.options.body);
  assert.deepEqual(payload, { primaryEmail: "j.doe@example.edu", name: "Jane Doe", username: "j_doe", primaryPhone: "573001112233" });
});

test("organization users default to no allowed global roles", () => {
  assert.deepEqual(getAllowedOrganizationUserGlobalRoleNames(), []);
});

test("new organization user with owner_global is removed and reported as critical", async () => {
  const requests = installRoleFetchMock({ roles: [{ id: "role-owner", name: "owner_global" }] });

  await assertOwnerGlobalRejection(
    { removeProhibitedRoles: true, existingUser: false },
    {
      removedRoleNames: ["owner_global"],
      retainedRoleNames: [],
      existingUser: false,
      diagnosticPattern: /newly created organization user/,
    }
  );

  assert.ok(requests.some((request) => request.options.method === "DELETE" && request.url.endsWith("/api/users/user-1/roles/role-owner")));
});

test("existing organization user with owner_global is rejected without deleting roles", async () => {
  const requests = installRoleFetchMock({ roles: [{ id: "role-owner", name: "owner_global" }] });

  await assertOwnerGlobalRejection(
    { removeProhibitedRoles: false, existingUser: true },
    {
      removedRoleNames: [],
      retainedRoleNames: ["owner_global"],
      existingUser: true,
      diagnosticPattern: /did not mutate the existing user/,
    }
  );

  assert.equal(requests.some((request) => request.options.method === "DELETE"), false);
});

test("legitimate global owner user does not lose owner_global by accident", async () => {
  const requests = installRoleFetchMock({ roles: [{ id: "role-owner", name: "owner_global" }] });

  await assertOwnerGlobalRejection(
    { existingUser: true },
    {
      removedRoleNames: [],
      retainedRoleNames: ["owner_global"],
      existingUser: true,
      diagnosticPattern: /choose a different base admin/,
    }
  );

  assert.equal(requests.filter((request) => request.options.method === "DELETE").length, 0);
});

test("listLogtoOrganizationUsers reads organization membership from Logto", async () => {
  const { listLogtoOrganizationUsers } = require("../services/logtoManagement");
  global.fetch = async (url) => {
    if (String(url).endsWith("/api/organizations/org-1/users")) return jsonResponse({ data: [{ id: "user-1", primaryEmail: "admin@example.edu" }] });
    throw new Error(`unexpected request: ${url}`);
  };

  const users = await listLogtoOrganizationUsers({ organizationId: "org-1" });
  assert.deepEqual(users, [{ id: "user-1", primaryEmail: "admin@example.edu" }]);
});

test("listLogtoOrganizationUserRoles reads only organization roles", async () => {
  const { listLogtoOrganizationUserRoles } = require("../services/logtoManagement");
  global.fetch = async (url) => {
    if (String(url).endsWith("/api/organizations/org-1/users/user-1/roles")) return jsonResponse({ data: [{ id: "role-admin", name: "Admin-org" }] });
    throw new Error(`unexpected request: ${url}`);
  };

  const roles = await listLogtoOrganizationUserRoles({ organizationId: "org-1", userId: "user-1" });
  assert.deepEqual(roles, [{ id: "role-admin", name: "Admin-org" }]);
});

test("createLogtoUserPasswordResetRequest degrades safely when admin reset is disabled", async () => {
  const { createLogtoUserPasswordResetRequest } = require("../services/logtoManagement");
  delete process.env.LOGTO_ENABLE_ADMIN_PASSWORD_RESET;

  await assert.rejects(
    createLogtoUserPasswordResetRequest({ userId: "user-1" }),
    (error) => {
      assert.equal(error.code, "LOGTO_UNSUPPORTED_CAPABILITY");
      assert.equal(error.body.reason, "unsupported_safe_reset");
      return true;
    }
  );
});

test("createLogtoUserPasswordResetRequest uses Logto password API only when explicitly enabled", async () => {
  const { createLogtoUserPasswordResetRequest } = require("../services/logtoManagement");
  process.env.LOGTO_ENABLE_ADMIN_PASSWORD_RESET = "true";
  process.env.LOGTO_ADMIN_RESET_PASSWORD_VALUE = "Temp-Password-123!";

  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/oidc/token")) return jsonResponse({ access_token: "token", expires_in: 3600 });
    if (String(url).endsWith("/api/users/user-1/password")) return jsonResponse({ updated: true });
    throw new Error(`unexpected request: ${url}`);
  };

  const result = await createLogtoUserPasswordResetRequest({ userId: "user-1" });

  assert.equal(result.status, "password_regenerated");
  const passwordRequest = requests.find((request) => request.url.endsWith("/api/users/user-1/password"));
  assert.equal(passwordRequest.options.method, "PATCH");
  assert.deepEqual(JSON.parse(passwordRequest.options.body), { password: "Temp-Password-123!" });

  delete process.env.LOGTO_ENABLE_ADMIN_PASSWORD_RESET;
  delete process.env.LOGTO_ADMIN_RESET_PASSWORD_VALUE;
});

test("Logto Management API request timeout is controlled", async () => {
  process.env.LOGTO_MANAGEMENT_TIMEOUT_MS = "10";
  const { listLogtoOrganizations } = require("../services/logtoManagement");

  global.fetch = async (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });

  await assert.rejects(listLogtoOrganizations(), (error) => {
    assert.match(error.code, /LOGTO_MANAGEMENT_(TOKEN|REQUEST)_TIMEOUT/);
    assert.match(error.diagnostic, /Network timeout/);
    return true;
  });

  delete process.env.LOGTO_MANAGEMENT_TIMEOUT_MS;
});
