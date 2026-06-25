const assert = require("node:assert/strict");
const test = require("node:test");

const {
  OWNER_GLOBAL_ROLE,
  OWNER_READ_SCOPE,
  OWNER_WRITE_SCOPE,
  createRequireOwner,
  getOwnerRequiredScopes,
  verifyTenantScopedMemberAccess,
} = require("../middleware/owner");

function createResponseRecorder() {
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

test("owner middleware requires owner_global even when global role claims were previously absent", async () => {
  const requireOwner = createRequireOwner();
  const req = { method: "GET", user: { scopes: [OWNER_READ_SCOPE], claims: {} }, params: {} };
  const res = createResponseRecorder();
  let nextCalled = false;

  await requireOwner(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.requiredRole, OWNER_GLOBAL_ROLE);
});


test("owner middleware accepts namespaced Civitas global role claim", async () => {
  const requireOwner = createRequireOwner();
  const req = {
    method: "GET",
    user: {
      scopes: [OWNER_READ_SCOPE],
      claims: { "https://civitas.socialstudies.cloud/claims/global_roles": [OWNER_GLOBAL_ROLE] },
    },
    params: {},
  };
  const res = createResponseRecorder();
  let nextCalled = false;

  await requireOwner(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.body, null);
});

test("owner middleware requires owner:write for mutating requests", async () => {
  const requireOwner = createRequireOwner();
  const req = {
    method: "PATCH",
    user: { scopes: [OWNER_READ_SCOPE], globalRoles: [OWNER_GLOBAL_ROLE], claims: {} },
    params: {},
  };
  const res = createResponseRecorder();
  let nextCalled = false;

  await requireOwner(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body.requiredScopes, [OWNER_READ_SCOPE, OWNER_WRITE_SCOPE]);
});

test("owner middleware allows read-only requests with owner_global and owner:read", async () => {
  const requireOwner = createRequireOwner();
  const req = {
    method: "GET",
    user: { scopes: [OWNER_READ_SCOPE], globalRoles: [OWNER_GLOBAL_ROLE], claims: {} },
    params: {},
  };
  const res = createResponseRecorder();
  let nextCalled = false;

  await requireOwner(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.body, null);
});

test("owner middleware blocks tenant-scoped member mutations when the user is not part of the requested organization", async () => {
  const requireOwner = createRequireOwner({
    listOrganizationUsers: async () => [{ id: "user-1" }, { id: "user-2" }],
  });
  const req = {
    method: "POST",
    user: { scopes: [OWNER_READ_SCOPE, OWNER_WRITE_SCOPE], globalRoles: [OWNER_GLOBAL_ROLE], claims: {} },
    params: { organizationId: "org-1", logtoUserId: "user-9" },
  };
  const res = createResponseRecorder();
  let nextCalled = false;

  await requireOwner(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 404);
  assert.match(res.body.message, /Organization member not found/i);
});

test("owner middleware allows tenant-scoped member mutations when the member belongs to the requested organization", async () => {
  const requireOwner = createRequireOwner({
    listOrganizationUsers: async () => [{ id: "user-9" }],
  });
  const req = {
    method: "POST",
    user: { scopes: [OWNER_READ_SCOPE, OWNER_WRITE_SCOPE], globalRoles: [OWNER_GLOBAL_ROLE], claims: {} },
    params: { organizationId: "org-1", logtoUserId: "user-9" },
  };
  const res = createResponseRecorder();
  let nextCalled = false;

  await requireOwner(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.body, null);
});

test("verifyTenantScopedMemberAccess compares against the canonical Logto membership list", async () => {
  assert.equal(
    await verifyTenantScopedMemberAccess({
      organizationId: "org-1",
      logtoUserId: "member-2",
      listOrganizationUsers: async () => [{ id: "member-1" }, { userId: "member-2" }],
    }),
    true
  );

  assert.equal(
    await verifyTenantScopedMemberAccess({
      organizationId: "org-1",
      logtoUserId: "member-3",
      listOrganizationUsers: async () => [{ id: "member-1" }, { userId: "member-2" }],
    }),
    false
  );
});

test("getOwnerRequiredScopes distinguishes read-only and mutating methods", () => {
  assert.deepEqual(getOwnerRequiredScopes("GET"), [OWNER_READ_SCOPE]);
  assert.deepEqual(getOwnerRequiredScopes("PATCH"), [OWNER_READ_SCOPE, OWNER_WRITE_SCOPE]);
});

test("owner middleware rejects organization tokens before evaluating owner scopes", async () => {
  const requireOwner = createRequireOwner();
  const req = {
    method: "GET",
    user: {
      organizationId: "org-1",
      scopes: [OWNER_READ_SCOPE, OWNER_WRITE_SCOPE],
      globalRoles: [OWNER_GLOBAL_ROLE],
      claims: {},
    },
    params: {},
  };
  const res = createResponseRecorder();
  let nextCalled = false;

  await requireOwner(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /global API access token/i);
});

test("owner middleware allows mutating requests with owner_global, owner:read and owner:write", async () => {
  const requireOwner = createRequireOwner();
  const req = {
    method: "POST",
    user: { scopes: [OWNER_READ_SCOPE, OWNER_WRITE_SCOPE], globalRoles: [OWNER_GLOBAL_ROLE], claims: {} },
    params: {},
  };
  const res = createResponseRecorder();
  let nextCalled = false;

  await requireOwner(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.body, null);
});
