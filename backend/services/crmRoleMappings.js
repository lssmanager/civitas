const { db } = require("../db/client");
const { crmRoleMappings } = require("../db/schema");

const PROHIBITED_ROLE_NAMES = new Set(["owner_global"]);
const CRM_ROLE_MAPPING_SOURCES = Object.freeze({
  DEFAULT: "default",
  GUI_OVERRIDE: "gui_override",
  ENV_MIGRATED: "env_migrated",
  UNMAPPED: "unmapped",
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
const getRoleName = (role = {}) => String(role.name || role.organizationRoleName || role.nameCache || role.key || "").trim();
const getRoleId = (role = {}) => String(role.id || role.logtoRoleId || role.logto_role_id || role.organizationRoleId || role.roleId || "").trim();
const isMappableRoleName = (name) => Boolean(name) && !PROHIBITED_ROLE_NAMES.has(name);

function normalizeEnvRoleMappingJsonValue(rawValue) {
  const value = String(rawValue || "").trim();
  const prefix = "FLUENTCRM_ROLE_SYNC_MAPPING_JSON=";
  if (value.startsWith(prefix)) return { value: value.slice(prefix.length).trim(), hadKeyPrefix: true };
  return { value, hadKeyPrefix: false };
}

function normalizeMappingEntry(role, entry = {}, source = CRM_ROLE_MAPPING_SOURCES.DEFAULT) {
  const organizationRoleName = typeof role === "string" ? role : getRoleName(role);
  const logtoRoleId = typeof role === "string" ? String(entry.logtoRoleId || entry.logto_role_id || "").trim() : getRoleId(role);
  return {
    logtoRoleId,
    organizationRoleName,
    tags: normalizeStringArray(entry.tags ?? entry.tagsJson),
    lists: normalizeStringArray(entry.lists ?? entry.listsJson),
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
  return Object.fromEntries(rows.filter((row) => row.logtoRoleId && isMappableRoleName(row.organizationRoleName)).map((row) => [row.logtoRoleId, {
    logtoRoleId: row.logtoRoleId,
    organizationRoleName: row.organizationRoleName,
    tags: normalizeStringArray(row.tagsJson),
    lists: normalizeStringArray(row.listsJson),
    roleType: row.roleType || "organizational",
    isActive: row.isActive !== false,
    source: row.source || CRM_ROLE_MAPPING_SOURCES.GUI_OVERRIDE,
  }]));
}

function buildRoleIndexes(logtoRoles = []) {
  const roles = logtoRoles.map((role) => ({ logtoRoleId: getRoleId(role), organizationRoleName: getRoleName(role) })).filter((role) => role.logtoRoleId && isMappableRoleName(role.organizationRoleName));
  const byId = new Map(roles.map((role) => [role.logtoRoleId, role]));
  const byName = new Map();
  const duplicateNames = new Set();
  for (const role of roles) {
    if (byName.has(role.organizationRoleName)) duplicateNames.add(role.organizationRoleName);
    byName.set(role.organizationRoleName, role);
  }
  return { roles, byId, byName, duplicateNames };
}

function resolveLegacyNameMappings({ namedMappings = {}, roleIndexes, source, warnings = [] }) {
  const resolved = {};
  for (const [name, entry] of Object.entries(namedMappings)) {
    if (!isMappableRoleName(name)) continue;
    const role = roleIndexes.byName.get(name);
    if (!role) { warnings.push(`Legacy CRM role mapping for '${name}' was ignored because no Logto role with that name exists.`); continue; }
    if (roleIndexes.duplicateNames.has(name)) { warnings.push(`Legacy CRM role mapping for '${name}' was ignored because the Logto role name is ambiguous.`); continue; }
    resolved[role.logtoRoleId] = normalizeMappingEntry(role, entry, source);
  }
  return resolved;
}

async function getEffectiveCrmRoleMapping({ database = db, logger = console, logtoRoles = [], persistedRows } = {}) {
  const warnings = [];
  const roleIndexes = buildRoleIndexes(logtoRoles);
  const rows = Array.isArray(persistedRows) ? persistedRows : await listPersistedCrmRoleMappings(database);
  const persisted = rowsToMapping(rows);
  const env = parseEnvRoleMappings(logger);
  if (env.warning) warnings.push(env.warning);
  const defaultById = resolveLegacyNameMappings({ namedMappings: DEFAULT_CRM_ROLE_MAPPINGS, roleIndexes, source: CRM_ROLE_MAPPING_SOURCES.DEFAULT, warnings: [] });
  const envById = resolveLegacyNameMappings({ namedMappings: env.mapping, roleIndexes, source: CRM_ROLE_MAPPING_SOURCES.ENV_MIGRATED, warnings });
  const mapping = {};
  for (const role of roleIndexes.roles) {
    mapping[role.logtoRoleId] = persisted[role.logtoRoleId] || envById[role.logtoRoleId] || defaultById[role.logtoRoleId] || normalizeMappingEntry(role, { isActive: false }, CRM_ROLE_MAPPING_SOURCES.UNMAPPED);
    mapping[role.logtoRoleId].logtoRoleId = role.logtoRoleId;
    mapping[role.logtoRoleId].organizationRoleName = role.organizationRoleName;
  }
  if (!roleIndexes.roles.length) Object.assign(mapping, persisted);
  const source = Object.keys(persisted).length ? "database" : Object.keys(envById).length ? CRM_ROLE_MAPPING_SOURCES.ENV_MIGRATED : CRM_ROLE_MAPPING_SOURCES.DEFAULT;
  return { mapping, source, envWarning: env.warning, warnings };
}

function buildRoleMappingResponse({ logtoRoles = [], persistedRows = [], effective }) {
  const roleIndexes = buildRoleIndexes(logtoRoles);
  const persisted = rowsToMapping(persistedRows);
  const mappingRoles = roleIndexes.roles.length
    ? roleIndexes.roles
    : Object.values(persisted).map((mapping) => ({ logtoRoleId: mapping.logtoRoleId, organizationRoleName: mapping.organizationRoleName }));
  const mappings = mappingRoles.map((role) => {
    const mapping = effective.mapping[role.logtoRoleId] || persisted[role.logtoRoleId] || normalizeMappingEntry(role, { isActive: false }, CRM_ROLE_MAPPING_SOURCES.UNMAPPED);
    return { logtoRoleId: role.logtoRoleId, organizationRoleName: role.organizationRoleName, tags: mapping.tags || [], lists: mapping.lists || [], roleType: mapping.roleType || "organizational", isActive: mapping.isActive !== false, source: persisted[role.logtoRoleId]?.source || mapping.source || effective.source, isCustomized: Boolean(persisted[role.logtoRoleId]) };
  });
  const unmappedRoles = mappings.filter((mapping) => mapping.isActive === false || mapping.source === CRM_ROLE_MAPPING_SOURCES.UNMAPPED).map((mapping) => ({ id: mapping.logtoRoleId, name: mapping.organizationRoleName }));
  return { roles: roleIndexes.roles.map((role) => ({ id: role.logtoRoleId, name: role.organizationRoleName })), mappings, warnings: effective.warnings || [], unmappedRoles, effectiveSource: effective.source, envWarning: effective.envWarning, note: "Civitas stores only operational CRM segmentation mappings keyed by Logto role id; Logto remains canonical for roles and memberships." };
}

async function loadCrmRoleMappingReadModel({ database = db, logger = console, listRoles } = {}) {
  const warnings = [];
  const roleLoader = typeof listRoles === "function" ? listRoles : async () => [];
  const [rolesResult, rowsResult] = await Promise.allSettled([roleLoader(), listPersistedCrmRoleMappings(database)]);

  if (rowsResult.status === "rejected") {
    const error = new Error("Unable to load persisted CRM role mappings from database");
    error.cause = rowsResult.reason;
    error.status = 500;
    throw error;
  }

  let logtoRoles = [];
  if (rolesResult.status === "fulfilled") {
    logtoRoles = Array.isArray(rolesResult.value) ? rolesResult.value : [];
    if (!Array.isArray(rolesResult.value)) warnings.push("Logto organization roles response was not an array; showing persisted mappings only.");
  } else {
    logger.warn?.("Unable to load Logto organization roles for FluentCRM role mappings", rolesResult.reason);
    warnings.push("No se pudieron cargar los roles organizacionales desde Logto; se muestran mappings persistidos si existen.");
  }

  const effective = await getEffectiveCrmRoleMapping({ database, logger, logtoRoles, persistedRows: rowsResult.value });
  effective.warnings = [...warnings, ...(effective.warnings || [])];
  return buildRoleMappingResponse({ logtoRoles, persistedRows: rowsResult.value, effective });
}

async function upsertCrmRoleMappings({ mappings = [], database = db } = {}) {
  const now = new Date();
  const rows = mappings.filter((item) => item.logtoRoleId && isMappableRoleName(item.organizationRoleName)).map((item) => ({
    logtoRoleId: item.logtoRoleId,
    organizationRoleName: item.organizationRoleName,
    tagsJson: normalizeStringArray(item.tags),
    listsJson: normalizeStringArray(item.lists),
    roleType: item.roleType || "organizational",
    isActive: item.isActive !== false,
    source: CRM_ROLE_MAPPING_SOURCES.GUI_OVERRIDE,
    updatedAt: now,
  }));
  for (const row of rows) {
    await database.insert(crmRoleMappings).values({ ...row, createdAt: now }).onConflictDoUpdate({ target: crmRoleMappings.logtoRoleId, set: row });
  }
  return rows;
}

async function resetCrmRoleMappings({ database = db } = {}) {
  await database.delete(crmRoleMappings);
}

module.exports = { CRM_ROLE_MAPPING_SOURCES, DEFAULT_CRM_ROLE_MAPPINGS, PROHIBITED_ROLE_NAMES, buildRoleMappingResponse, getEffectiveCrmRoleMapping, isMappableRoleName, loadCrmRoleMappingReadModel, normalizeEnvRoleMappingJsonValue, normalizeMappingEntry, parseEnvRoleMappings, resetCrmRoleMappings, upsertCrmRoleMappings };
