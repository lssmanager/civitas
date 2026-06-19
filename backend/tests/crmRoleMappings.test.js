const assert = require("node:assert/strict");
const test = require("node:test");
const { buildRoleMappingResponse, getEffectiveCrmRoleMapping, parseEnvRoleMappings } = require("../services/crmRoleMappings");

function restoreEnv(previous) {
  if (previous === undefined) delete process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON;
  else process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON = previous;
}

const roles = [
  { id: "role-admin", name: "Admin-org" },
  { id: "role-student", name: "Student-org" },
  { id: "role-teacher", name: "Teacher-org" },
  { id: "role-new", name: "New Role" },
  { id: "owner", name: "owner_global" },
];

test("CRM role mapping falls back to defaults by Logto role id and excludes owner_global", async () => {
  const previous = process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON;
  delete process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON;
  const database = { select: () => ({ from: async () => [] }) };
  const result = await getEffectiveCrmRoleMapping({ database, logtoRoles: roles });
  assert.equal(result.source, "default");
  assert.deepEqual(result.mapping["role-admin"].tags, ["civitas-role-admin-org"]);
  const response = buildRoleMappingResponse({ logtoRoles: roles, persistedRows: [], effective: result });
  assert.deepEqual(response.roles.map((role) => role.name), ["Admin-org", "Student-org", "Teacher-org", "New Role"]);
  assert.equal(response.mappings.find((item) => item.logtoRoleId === "role-new").source, "unmapped");
  restoreEnv(previous);
});

test("CRM role mapping preserves overrides across Logto role rename because key is logto_role_id", async () => {
  const database = { select: () => ({ from: async () => [{ logtoRoleId: "role-teacher", organizationRoleName: "Teacher-org", tagsJson: ["teacher-custom"], listsJson: ["Teachers"], roleType: "instruction", isActive: true, source: "gui_override" }] }) };
  const result = await getEffectiveCrmRoleMapping({ database, logtoRoles: [{ id: "role-teacher", name: "Instructor-org" }] });
  assert.deepEqual(result.mapping["role-teacher"].tags, ["teacher-custom"]);
  assert.equal(result.mapping["role-teacher"].organizationRoleName, "Instructor-org");
});

test("CRM role mapping resolves legacy env names against current Logto roles", async () => {
  const previous = process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON;
  process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON = JSON.stringify({ "Teacher-org": { tags: ["teacher-custom"], lists: ["Teachers"], roleType: "instruction" } });
  const database = { select: () => ({ from: async () => [] }) };
  const result = await getEffectiveCrmRoleMapping({ database, logtoRoles: roles });
  assert.equal(result.source, "env_migrated");
  assert.deepEqual(result.mapping["role-teacher"].tags, ["teacher-custom"]);
  restoreEnv(previous);
});

test("CRM role mapping warns and ignores unresolvable legacy env names", async () => {
  const previous = process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON;
  process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON = JSON.stringify({ "Missing Role": { tags: ["missing"] } });
  const database = { select: () => ({ from: async () => [] }) };
  const result = await getEffectiveCrmRoleMapping({ database, logtoRoles: roles });
  assert.match(result.warnings.join("\n"), /Missing Role/);
  assert.equal(Object.values(result.mapping).some((entry) => entry.tags.includes("missing")), false);
  restoreEnv(previous);
});

test("malformed CRM role mapping env warns without throwing", () => {
  const previous = process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON;
  const warnings = [];
  process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON = "{";
  const result = parseEnvRoleMappings({ warn: (...args) => warnings.push(args) });
  assert.deepEqual(result.mapping, {});
  assert.match(result.warning, /malformed/);
  assert.equal(warnings.length, 1);
  restoreEnv(previous);
});

test("CRM role mapping env accepts accidental KEY= prefix", () => {
  const previous = process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON;
  const warnings = [];
  process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON = 'FLUENTCRM_ROLE_SYNC_MAPPING_JSON={"Teacher-org":{"tags":["teacher-prefixed"],"lists":["Teachers"]}}';
  const result = parseEnvRoleMappings({ warn: (...args) => warnings.push(args) });
  assert.deepEqual(result.mapping["Teacher-org"].tags, ["teacher-prefixed"]);
  assert.match(result.warning, /KEY= prefix/);
  assert.equal(warnings.length, 1);
  restoreEnv(previous);
});

test("CRM role mapping read model returns persisted mappings with warnings when Logto fails", async () => {
  const { loadCrmRoleMappingReadModel } = require("../services/crmRoleMappings");
  const database = { select: () => ({ from: async () => [{ logtoRoleId: "role-teacher", organizationRoleName: "Teacher-org", tagsJson: ["teacher-custom"], listsJson: ["Teachers"], roleType: "instruction", isActive: true, source: "gui_override" }] }) };
  const warnings = [];
  const response = await loadCrmRoleMappingReadModel({ database, logger: { warn: (...args) => warnings.push(args) }, listRoles: async () => { throw new Error("Logto Management API request failed"); } });
  assert.equal(response.mappings.length, 1);
  assert.equal(response.mappings[0].logtoRoleId, "role-teacher");
  assert.match(response.warnings.join("\n"), /Logto/);
  assert.equal(warnings.length, 1);
});

test("CRM role mapping read model throws controlled database error when persisted mappings fail", async () => {
  const { loadCrmRoleMappingReadModel } = require("../services/crmRoleMappings");
  const database = { select: () => ({ from: async () => { throw new Error('relation "crm_role_mappings" does not exist'); } }) };
  await assert.rejects(
    loadCrmRoleMappingReadModel({ database, listRoles: async () => roles }),
    (error) => error.status === 500 && /persisted CRM role mappings/.test(error.message) && /crm_role_mappings/.test(error.cause.message)
  );
});

test("inactive CRM role mappings are reported as unmapped for sync", async () => {
  const database = { select: () => ({ from: async () => [{ logtoRoleId: "role-student", organizationRoleName: "Student-org", tagsJson: ["student"], listsJson: [], roleType: "organizational", isActive: false, source: "gui_override" }] }) };
  const result = await getEffectiveCrmRoleMapping({ database, logtoRoles: roles });
  const response = buildRoleMappingResponse({ logtoRoles: roles, persistedRows: await database.select().from(), effective: result });
  assert.equal(response.mappings.find((item) => item.logtoRoleId === "role-student").isActive, false);
  assert.deepEqual(response.unmappedRoles.find((role) => role.id === "role-student"), { id: "role-student", name: "Student-org" });
});
