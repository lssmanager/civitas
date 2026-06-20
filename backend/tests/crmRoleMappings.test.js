const assert = require("node:assert/strict");
const test = require("node:test");
const { buildRoleMappingResponse, getDatabaseErrorDiagnostic, getEffectiveCrmRoleMapping, loadCrmRoleMappingReadModel, parseEnvRoleMappings, rowsToMapping } = require("../services/crmRoleMappings");

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

test("CRM role mapping env rejects accidental KEY= prefix", () => {
  const previous = process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON;
  const warnings = [];
  process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON = 'FLUENTCRM_ROLE_SYNC_MAPPING_JSON={"Teacher-org":{"tags":["teacher-prefixed"],"lists":["Teachers"]}}';
  const result = parseEnvRoleMappings({ warn: (...args) => warnings.push(args) });
  assert.deepEqual(result.mapping, {});
  assert.match(result.warning, /includes its variable name|configured as/);
  assert.equal(warnings.length, 1);
  restoreEnv(previous);
});


test("CRM legacy env ignores empty duplicated key value without contaminating mappings", () => {
  const previous = process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON;
  const warnings = [];
  process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON = "FLUENTCRM_ROLE_SYNC_MAPPING_JSON=";
  const result = parseEnvRoleMappings({ warn: (...args) => warnings.push(args) });
  assert.deepEqual(result.mapping, {});
  assert.match(result.warning, /ignored|primary/);
  restoreEnv(previous);
});

test("CRM role mapping read model returns persisted mappings with warnings when Logto fails", async () => {
  const database = { select: () => ({ from: async () => [{ logtoRoleId: "role-teacher", organizationRoleName: "Teacher-org", tagsJson: ["teacher-custom"], listsJson: ["Teachers"], roleType: "instruction", isActive: true, source: "gui_override" }] }) };
  const warnings = [];
  const response = await loadCrmRoleMappingReadModel({ database, logger: { warn: (...args) => warnings.push(args) }, listRoles: async () => { throw new Error("Logto Management API request failed"); } });
  assert.equal(response.mappings.length, 1);
  assert.equal(response.mappings[0].logtoRoleId, "role-teacher");
  assert.match(response.warnings.join("\n"), /Logto/);
  assert.equal(warnings.length, 1);
});

test("CRM role mapping read model falls back with actionable PostgreSQL warning when table is missing", async () => {
  const error = new Error('relation "crm_role_mappings" does not exist');
  error.code = "42P01";
  const database = { select: () => ({ from: async () => { throw error; } }) };
  const logs = [];
  const response = await loadCrmRoleMappingReadModel({ database, logger: { error: (...args) => logs.push(args), warn: () => {} }, listRoles: async () => roles });
  assert.match(response.warnings.join("\n"), /crm_role_mappings is missing.*42P01/);
  assert.match(response.warnings.join("\n"), /migraci.n correctiva/);
  assert.equal(logs.length, 1);
  assert.match(logs[0][1].diagnostic, /relation.*crm_role_mappings/);
});

test("inactive CRM role mappings are reported as unmapped for sync", async () => {
  const database = { select: () => ({ from: async () => [{ logtoRoleId: "role-student", organizationRoleName: "Student-org", tagsJson: ["student"], listsJson: [], roleType: "organizational", isActive: false, source: "gui_override" }] }) };
  const result = await getEffectiveCrmRoleMapping({ database, logtoRoles: roles });
  const response = buildRoleMappingResponse({ logtoRoles: roles, persistedRows: await database.select().from(), effective: result });
  assert.equal(response.mappings.find((item) => item.logtoRoleId === "role-student").isActive, false);
  assert.deepEqual(response.unmappedRoles.find((role) => role.id === "role-student"), { id: "role-student", name: "Student-org" });
});


test("CRM role mapping read model reports missing logto_role_id column", async () => {
  const error = new Error('column "logto_role_id" does not exist');
  error.code = "42703";
  const database = { select: () => ({ from: async () => { throw error; } }) };
  const response = await loadCrmRoleMappingReadModel({ database, logger: { error: () => {}, warn: () => {} }, listRoles: async () => roles });
  assert.match(response.warnings.join("\n"), /missing an expected column.*42703.*logto_role_id/);
});

test("CRM role mapping normalizes legacy organization_role_name rows and FluentCRM list columns", () => {
  const mapping = rowsToMapping([{ logto_role_id: "role-teacher", organization_role_name: "Teacher-org", fluentcrm_tags: ["legacy-tag"], fluentcrm_lists: ["Legacy List"], is_active: true }]);
  assert.deepEqual(mapping["role-teacher"].tags, ["legacy-tag"]);
  assert.deepEqual(mapping["role-teacher"].lists, ["Legacy List"]);
});

test("CRM role mapping reads successful overrides by Logto role id", async () => {
  const database = { select: () => ({ from: async () => [{ logtoRoleId: "role-new", organizationRoleName: "New Role", tagsJson: ["db-new"], listsJson: ["DB New"], isActive: true, source: "gui_override" }] }) };
  const result = await getEffectiveCrmRoleMapping({ database, logtoRoles: roles });
  assert.equal(result.source, "database");
  assert.deepEqual(result.mapping["role-new"].tags, ["db-new"]);
});

test("valid CRM role mapping env accepts only a JSON object value without warning", () => {
  const previous = process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON;
  const warnings = [];
  process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON = '{"Teacher-org":{"tags":["teacher-valid"],"lists":["Teachers"]}}';
  const result = parseEnvRoleMappings({ warn: (...args) => warnings.push(args) });
  assert.deepEqual(result.mapping["Teacher-org"].tags, ["teacher-valid"]);
  assert.equal(result.warning, null);
  assert.equal(warnings.length, 0);
  restoreEnv(previous);
});

test("database diagnostics identify permission, syntax, and DATABASE_URL failures", () => {
  assert.match(getDatabaseErrorDiagnostic(Object.assign(new Error("permission denied for table crm_role_mappings"), { code: "42501" })), /cannot read/);
  assert.match(getDatabaseErrorDiagnostic(Object.assign(new Error("invalid input syntax for type json"), { code: "22P02" })), /invalid/);
  assert.match(getDatabaseErrorDiagnostic(new Error("password authentication failed for DATABASE_URL")), /DATABASE_URL/);
});
