const assert = require("node:assert/strict");
const test = require("node:test");
const {
  getEffectiveWordPressRoleMapping,
  listWordPressRoles,
  loadWordPressRoleMappingReadModel,
  normalizeWordPressRolesResponse,
  upsertWordPressRoleMappings,
} = require("../services/wordpressRoles");

const logtoRoles = [
  { id: "role-admin", name: "Admin-org" },
  { id: "role-student", name: "Student-org" },
  { id: "role-new", name: "New Role" },
  { id: "owner", name: "owner_global" },
];

function makeResponse({ ok = true, status = 200, body }) {
  return { ok, status, text: async () => JSON.stringify(body), headers: { get: () => "application/json" } };
}

test("normalizes explicit WordPress roles catalog response", () => {
  const roles = normalizeWordPressRolesResponse({ roles: [{ slug: "subscriber", name: "Subscriber" }, { key: "teacher", label: "Teacher" }] });
  assert.deepEqual(roles.map((role) => role.slug), ["subscriber", "teacher"]);
});

test("lists WordPress roles from explicit WordPress integration endpoint", async () => {
  const calls = [];
  const roles = await listWordPressRoles({
    config: { baseUrl: "https://wp.example", username: "owner", appPassword: "secret", rolesPath: "/wp-json/civitas/v1/roles", timeoutMs: 1000 },
    fetchImpl: async (url, options) => { calls.push({ url, options }); return makeResponse({ body: { roles: [{ slug: "subscriber", name: "Subscriber" }] } }); },
  });
  assert.equal(calls[0].url, "https://wp.example/wp-json/civitas/v1/roles");
  assert.match(calls[0].options.headers.Authorization, /^Basic /);
  assert.deepEqual(roles, [{ slug: "subscriber", name: "Subscriber", description: "", source: "wordpress" }]);
});

test("WordPress role mapping is keyed by Logto role id and excludes owner_global", async () => {
  const database = { select: () => ({ from: async () => [{ logtoRoleId: "role-student", organizationRoleName: "Student-org", wordpressRoleSlug: "subscriber", wordpressRoleName: "Subscriber", isActive: true, source: "gui_override" }] }) };
  const result = await getEffectiveWordPressRoleMapping({ database, logtoRoles });
  assert.equal(result.mapping["role-student"].wordpressRoleSlug, "subscriber");
  assert.equal(result.mapping["role-new"].source, "unmapped");
  assert.equal(result.mapping.owner, undefined);
});

test("WordPress role mapping read model tolerates catalog failures with warning", async () => {
  const database = { select: () => ({ from: async () => [] }) };
  const response = await loadWordPressRoleMappingReadModel({ database, listRoles: async () => logtoRoles, listWpRoles: async () => { throw new Error("missing civitas roles endpoint"); }, logger: { warn: () => {}, error: () => {} } });
  assert.equal(response.wordpressRoles.length, 0);
  assert.match(response.warnings.join("\n"), /missing civitas roles endpoint/);
  assert.match(response.note, /Logto remains canonical/);
});

test("upsert WordPress role mappings writes operational rows only for mappable Logto roles", async () => {
  const inserted = [];
  const database = {
    insert: () => ({ values: (row) => ({ onConflictDoUpdate: async () => inserted.push(row) }) }),
  };
  const rows = await upsertWordPressRoleMappings({
    database,
    wordpressRoles: [{ slug: "subscriber", name: "Subscriber" }],
    mappings: [
      { logtoRoleId: "role-student", organizationRoleName: "Student-org", wordpressRoleSlug: "subscriber" },
      { logtoRoleId: "owner", organizationRoleName: "owner_global", wordpressRoleSlug: "administrator" },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(inserted[0].wordpressRoleName, "Subscriber");
  assert.equal(inserted[0].logtoRoleId, "role-student");
});
