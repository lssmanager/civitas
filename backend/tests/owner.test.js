const test = require("node:test");
const assert = require("node:assert/strict");

const { requireOwner } = require("../middleware/owner");

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function runRequireOwner(user) {
  const req = { user };
  const res = createResponse();
  let nextCalled = false;

  requireOwner(req, res, () => {
    nextCalled = true;
  });

  return { res, nextCalled };
}

test("requireOwner allows a global owner token when owner scope is present and role claims are absent", async () => {
  const { res, nextCalled } = runRequireOwner({
    scopes: ["owner:read"],
    claims: {},
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test("requireOwner ignores organization role claims when no global role claims are present", async () => {
  const { res, nextCalled } = runRequireOwner({
    scopes: ["owner:read"],
    organizationRoles: ["Admin-org"],
    claims: { organization_roles: ["Admin-org"] },
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test("requireOwner allows global owner role with owner scope", async () => {
  const { res, nextCalled } = runRequireOwner({
    scopes: ["owner:read"],
    globalRoles: ["owner_global"],
    organizationRoles: ["Admin-org"],
    claims: { global_roles: ["owner_global"], organization_roles: ["Admin-org"] },
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test("requireOwner rejects organization-scoped tokens", async () => {
  const { res, nextCalled } = runRequireOwner({
    organizationId: "org_123",
    scopes: ["owner:read"],
    organizationRoles: ["Admin-org"],
    claims: { organization_roles: ["Admin-org"] },
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /global API access token/i);
});

test("requireOwner rejects global tokens with explicit non-owner global roles", async () => {
  const { res, nextCalled } = runRequireOwner({
    scopes: ["owner:read"],
    globalRoles: ["support_global"],
    organizationRoles: ["Admin-org"],
    claims: { global_roles: ["support_global"], organization_roles: ["Admin-org"] },
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.requiredRole, "owner_global");
  assert.match(res.body.message, /global role claims/i);
});
