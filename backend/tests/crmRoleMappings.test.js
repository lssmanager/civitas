const assert = require("node:assert/strict");
const test = require("node:test");
const { buildRoleMappingResponse, getEffectiveCrmRoleMapping, parseEnvRoleMappings } = require("../services/crmRoleMappings");

test("CRM role mapping falls back to defaults and excludes owner_global", async () => {
  const previous = process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON;
  delete process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON;
  const database = { select: () => ({ from: async () => [] }) };
  const result = await getEffectiveCrmRoleMapping({ database });
  assert.equal(result.source, "default");
  assert.ok(result.mapping["Admin-org"]);
  const response = buildRoleMappingResponse({ logtoRoles: [{ id: "owner", name: "owner_global" }, { id: "student", name: "Student-org" }], persistedRows: [], effective: result });
  assert.deepEqual(response.roles.map((role) => role.name), ["Student-org", "Admin-org", "Teacher-org", "Tutor-org", "Beginner Student", "Pro Student", "Expert-Student", "admin", "student", "teacher"]);
  process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON = previous;
});

test("CRM role mapping uses env only when database has no persisted config", async () => {
  const previous = process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON;
  process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON = JSON.stringify({ "Teacher-org": { tags: ["teacher-custom"], lists: ["Teachers"], roleType: "instruction" } });
  const database = { select: () => ({ from: async () => [] }) };
  const result = await getEffectiveCrmRoleMapping({ database });
  assert.equal(result.source, "env_migrated");
  assert.deepEqual(result.mapping["Teacher-org"].tags, ["teacher-custom"]);
  process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON = previous;
});

test("malformed CRM role mapping env warns without throwing", () => {
  const previous = process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON;
  const warnings = [];
  process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON = "{";
  const result = parseEnvRoleMappings({ warn: (...args) => warnings.push(args) });
  assert.deepEqual(result.mapping, {});
  assert.match(result.warning, /malformed/);
  assert.equal(warnings.length, 1);
  process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON = previous;
});
