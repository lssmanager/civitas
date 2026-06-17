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
