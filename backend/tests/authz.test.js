const assert = require("node:assert/strict");
const test = require("node:test");
const { requireOwner } = require("../middleware/owner");
const { requireOrganizationRole } = require("../middleware/auth");

function runMiddleware(middleware, req) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; resolve(this); } };
    middleware(req, res, () => resolve({ statusCode: 200, next: true }));
  });
}

test("owner route requires global owner role and rejects ambiguous global scope only", async () => {
  const result = await runMiddleware(requireOwner, { user: { scopes: ["owner:read"], roles: [] } });
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.requiredRole, "owner_global");
});

test("owner route allows global owner role with owner scope", async () => {
  const result = await runMiddleware(requireOwner, { user: { scopes: ["owner:read"], roles: ["owner_global"] } });
  assert.equal(result.next, true);
});

test("organization directory role guard allows admin-org and denies regular members", async () => {
  const admin = await runMiddleware(requireOrganizationRole("Admin-org"), { user: { roles: ["Admin-org"] } });
  const member = await runMiddleware(requireOrganizationRole("Admin-org"), { user: { roles: ["Student-org"] } });
  assert.equal(admin.next, true);
  assert.equal(member.statusCode, 403);
  assert.equal(member.body.requiredRole, "Admin-org");
});
