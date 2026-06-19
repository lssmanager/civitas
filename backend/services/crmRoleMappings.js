const { db } = require("../db/client");
const { crmRoleMappings } = require("../db/schema");

const PROHIBITED_ROLE_NAMES = new Set(["owner_global"]);
const CRM_ROLE_MAPPING_SOURCES = Object.freeze({
  DEFAULT: "default",
  GUI_OVERRIDE: "gui_override",
  ENV_MIGRATED: "env_migrated",
});

const DEFAULT_CRM_ROLE_MAPPINGS = Object.freeze({
  "Admin-org": { tags: ["civitas-role-admin-org"], lists: ["Civitas Admins"], roleType: "organizational" },
  "Student-org": { tags: ["civitas-role-student-org"], lists: ["Civitas Students"], roleType: "organizational" },
  "Teacher-org": { tags: ["civitas-role-teacher-org"], lists: ["Civitas Teachers"], roleType: "organizational" },
  "Tutor-org": { tags: ["civitas-role-tutor-org"], lists: ["Civitas Tutors"], roleType: "organizational" },
  "Beginner Student": { tags: ["civitas-role-beginner-student"], lists: ["Civitas Beginner Students"], roleType: "organizational" },
  "Pro Student": { tags: ["civitas-role-pro-student"], lists: ["Civitas Pro Students"], roleType: "organizational" },
  "Expert-Student": { tags: ["civitas-role-expert-student"], lists: ["Civitas Expert Students"], roleType: "organizational" },
  admin: { tags: ["civitas-legacy-admin"], lists: ["Civitas Legacy Admins"], roleType: "legacy_alias" },
  student: { tags: ["civitas-legacy-student"], lists: ["Civitas Legacy Students"], roleType: "legacy_alias" },
  teacher: { tags: ["civitas-legacy-teacher"], lists: ["Civitas Legacy Teachers"], roleType: "legacy_alias" },
});

const normalizeStringArray = (value) => Array.isArray(value) ? [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))] : [];

function normalizeEnvRoleMappingJsonValue(rawValue) {
  const value = String(rawValue || "").trim();
  const prefix = "FLUENTCRM_ROLE_SYNC_MAPPING_JSON=";
  if (value.startsWith(prefix)) return { value: value.slice(prefix.length).trim(), hadKeyPrefix: true };
  return { value, hadKeyPrefix: false };
}
const isMappableRoleName = (name) => Boolean(name) && !PROHIBITED_ROLE_NAMES.has(name);

function normalizeMappingEntry(roleName, entry = {}, source = CRM_ROLE_MAPPING_SOURCES.DEFAULT) {
  return {
    organizationRoleName: String(roleName || "").trim(),
    tags: normalizeStringArray(entry.tags),
    lists: normalizeStringArray(entry.lists),
    roleType: String(entry.roleType || "organizational").trim() || "organizational",
    isActive: entry.isActive !== false,
    source,
  };
}

function parseEnvRoleMappings(logger = console) {
  if (!process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON) return { mapping: {}, warning: null };
  const normalized = normalizeEnvRoleMappingJsonValue(process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON);
  try {
    const parsed = JSON.parse(normalized.value);
    const mapping = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    const warning = normalized.hadKeyPrefix ? "FLUENTCRM_ROLE_SYNC_MAPPING_JSON included a KEY= prefix; Civitas ignored the prefix and used the JSON object value" : null;
    if (warning) logger.warn?.(warning);
    return { mapping, warning };
  } catch (error) {
    const warning = "FLUENTCRM_ROLE_SYNC_MAPPING_JSON is malformed; using persisted mappings or defaults. Provide only the JSON object value, not a KEY= prefix.";
    logger.warn?.(warning, error.message);
    return { mapping: {}, warning };
  }
}

async function listPersistedCrmRoleMappings(database = db) {
  return database.select().from(crmRoleMappings);
}

function rowsToMapping(rows = []) {
  return Object.fromEntries(rows.filter((row) => isMappableRoleName(row.organizationRoleName)).map((row) => [row.organizationRoleName, {
    tags: normalizeStringArray(row.tagsJson),
    lists: normalizeStringArray(row.listsJson),
    roleType: row.roleType || "organizational",
    isActive: row.isActive !== false,
    source: row.source || CRM_ROLE_MAPPING_SOURCES.GUI_OVERRIDE,
  }]));
}

async function getEffectiveCrmRoleMapping({ database = db, logger = console } = {}) {
  const rows = await listPersistedCrmRoleMappings(database);
  if (rows.length) return { mapping: rowsToMapping(rows), source: "database", envWarning: null };
  const env = parseEnvRoleMappings(logger);
  if (Object.keys(env.mapping).length) {
    const mapping = Object.fromEntries(Object.entries({ ...DEFAULT_CRM_ROLE_MAPPINGS, ...env.mapping }).filter(([name]) => isMappableRoleName(name)).map(([name, entry]) => [name, normalizeMappingEntry(name, entry, CRM_ROLE_MAPPING_SOURCES.ENV_MIGRATED)]));
    return { mapping, source: CRM_ROLE_MAPPING_SOURCES.ENV_MIGRATED, envWarning: env.warning };
  }
  return { mapping: DEFAULT_CRM_ROLE_MAPPINGS, source: CRM_ROLE_MAPPING_SOURCES.DEFAULT, envWarning: env.warning };
}

function buildRoleMappingResponse({ logtoRoles = [], persistedRows = [], effective }) {
  const roleNames = [...new Set([...logtoRoles.map((role) => role.name || role.nameCache || role.key).filter(isMappableRoleName), ...Object.keys(effective.mapping).filter(isMappableRoleName)])];
  const persisted = rowsToMapping(persistedRows);
  return {
    roles: roleNames.map((name) => ({ id: logtoRoles.find((role) => (role.name || role.nameCache || role.key) === name)?.id || name, name })),
    mappings: roleNames.map((name) => {
      const mapping = effective.mapping[name] || normalizeMappingEntry(name, {}, CRM_ROLE_MAPPING_SOURCES.DEFAULT);
      return { organizationRoleName: name, tags: mapping.tags || [], lists: mapping.lists || [], roleType: mapping.roleType || "organizational", isActive: mapping.isActive !== false, source: persisted[name]?.source || mapping.source || effective.source, isCustomized: Boolean(persisted[name]) };
    }),
    effectiveSource: effective.source,
    envWarning: effective.envWarning,
    note: "Civitas stores only operational CRM segmentation mappings; Logto remains canonical for roles and memberships.",
  };
}

async function upsertCrmRoleMappings({ mappings = [], database = db } = {}) {
  const now = new Date();
  const rows = mappings.filter((item) => isMappableRoleName(item.organizationRoleName)).map((item) => ({
    organizationRoleName: item.organizationRoleName,
    tagsJson: normalizeStringArray(item.tags),
    listsJson: normalizeStringArray(item.lists),
    roleType: item.roleType || "organizational",
    isActive: item.isActive !== false,
    source: CRM_ROLE_MAPPING_SOURCES.GUI_OVERRIDE,
    updatedAt: now,
  }));
  for (const row of rows) {
    await database.insert(crmRoleMappings).values({ ...row, createdAt: now }).onConflictDoUpdate({ target: crmRoleMappings.organizationRoleName, set: row });
  }
  return rows;
}

async function resetCrmRoleMappings({ database = db } = {}) {
  await database.delete(crmRoleMappings);
}

module.exports = { CRM_ROLE_MAPPING_SOURCES, DEFAULT_CRM_ROLE_MAPPINGS, PROHIBITED_ROLE_NAMES, buildRoleMappingResponse, getEffectiveCrmRoleMapping, isMappableRoleName, normalizeEnvRoleMappingJsonValue, normalizeMappingEntry, parseEnvRoleMappings, resetCrmRoleMappings, upsertCrmRoleMappings };
