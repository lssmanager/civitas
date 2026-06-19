const assert = require("node:assert/strict");
const test = require("node:test");
const { requireOwner } = require("../middleware/owner");
const { extractGlobalRoleNames, extractOrganizationRoleNames, extractRoleNames, requireOrganizationRole } = require("../middleware/auth");

function runMiddleware(middleware, req) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; resolve(this); } };
    middleware(req, res, () => resolve({ statusCode: 200, next: true }));
  });
}

test("owner route falls back to owner scope when global role claims are absent", async () => {
  const result = await runMiddleware(requireOwner, { user: { scopes: ["owner:read"], roles: [] } });
  assert.equal(result.next, true);
});

test("owner route allows global owner role with owner scope", async () => {
  const result = await runMiddleware(requireOwner, { user: { scopes: ["owner:read"], globalRoles: ["owner_global"] } });
  assert.equal(result.next, true);
});

test("organization directory role guard allows admin-org and denies regular members", async () => {
  const admin = await runMiddleware(requireOrganizationRole("Admin-org"), { user: { organizationRoles: ["Admin-org"] } });
  const member = await runMiddleware(requireOrganizationRole("Admin-org"), { user: { organizationRoles: ["Student-org"] } });
  assert.equal(admin.next, true);
  assert.equal(member.statusCode, 403);
  assert.equal(member.body.requiredRole, "Admin-org");
});


test("role extractors keep global and organization role claims separate", () => {
  const payload = {
    roles: ["owner_global"],
    role_names: "support_global",
    global_roles: ["billing_global"],
    organization_roles: ["Admin-org"],
    organizationRoles: "Teacher-org",
    org_roles: ["Student-org"],
  };

  assert.deepEqual(extractGlobalRoleNames(payload).sort(), ["billing_global", "owner_global", "support_global"].sort());
  assert.deepEqual(extractOrganizationRoleNames(payload).sort(), ["Admin-org", "Student-org", "Teacher-org"].sort());
  assert.deepEqual(extractRoleNames(payload).sort(), ["Admin-org", "Student-org", "Teacher-org", "billing_global", "owner_global", "support_global"].sort());
});
