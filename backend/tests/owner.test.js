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

test("requireOwner allows a global owner token when owner scope is present and role claims are absent", async () => {
  const req = {
    user: {
      scopes: ["owner:read"],
      claims: {},
    },
  };
  const res = createResponse();
  let nextCalled = false;

  requireOwner(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test("requireOwner rejects organization-scoped tokens", async () => {
  const req = {
    user: {
      organizationId: "org_123",
      scopes: ["owner:read"],
      claims: {},
    },
  };
  const res = createResponse();
  let nextCalled = false;

  requireOwner(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /global API access token/i);
});

test("requireOwner rejects global tokens with explicit non-owner roles", async () => {
  const req = {
    user: {
      scopes: ["owner:read"],
      roles: ["Admin-org"],
      claims: { roles: ["Admin-org"] },
    },
  };
  const res = createResponse();
  let nextCalled = false;

  requireOwner(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.requiredRole, "owner_global");
});