const { db } = require("../db/client");
const { wordpressRoleMappings } = require("../db/schema");

const WORDPRESS_ROLE_MAPPING_SOURCES = Object.freeze({
  GUI_OVERRIDE: "gui_override",
  UNMAPPED: "unmapped",
});
const PROHIBITED_ROLE_NAMES = new Set(["owner_global"]);

class WordPressRolesError extends Error {
  constructor(message, { status, body, code, diagnostic, request } = {}) {
    super(message);
    this.name = "WordPressRolesError";
    this.status = status;
    this.body = body;
    this.code = code;
    this.diagnostic = diagnostic || null;
    this.request = request || null;
  }
}

const normalizeString = (value) => String(value || "").trim();
const getRoleName = (role = {}) => normalizeString(role.name || role.organizationRoleName || role.nameCache || role.key);
const getRoleId = (role = {}) => normalizeString(role.id || role.logtoRoleId || role.logto_role_id || role.organizationRoleId || role.roleId);
const isMappableRoleName = (name) => Boolean(name) && !PROHIBITED_ROLE_NAMES.has(name);

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch (error) {
    throw new WordPressRolesError("WORDPRESS_BASE_URL must be a valid absolute URL", { code: "WORDPRESS_CONFIG_INVALID" });
  }
}

function getWordPressRolesConfig() {
  const baseUrl = normalizeBaseUrl(process.env.WORDPRESS_BASE_URL);
  const username = process.env.WORDPRESS_USERNAME;
  const appPassword = process.env.WORDPRESS_APP_PASSWORD;
  const rolesPath = process.env.WORDPRESS_ROLES_ENDPOINT || "/wp-json/civitas/v1/roles";
  const timeoutMs = Number.parseInt(process.env.WORDPRESS_TIMEOUT_MS || "10000", 10);
  const missing = [];
  if (!baseUrl) missing.push("WORDPRESS_BASE_URL");
  if (!username) missing.push("WORDPRESS_USERNAME");
  if (!appPassword) missing.push("WORDPRESS_APP_PASSWORD");
  if (missing.length) {
    throw new WordPressRolesError(`WordPress roles integration is not configured; missing ${missing.join(", ")}`, {
      code: "WORDPRESS_CONFIG_MISSING",
      body: { missing },
      diagnostic: "Configure WordPress base URL and application-password credentials. Roles are a supplemental synchronization catalog, not a Civitas authorization source.",
    });
  }
  return { baseUrl, username, appPassword, rolesPath, timeoutMs: Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10000 };
}

function buildRolesUrl(config) {
  if (/^https?:\/\//i.test(config.rolesPath)) return config.rolesPath;
  return `${config.baseUrl}${config.rolesPath.startsWith("/") ? "" : "/"}${config.rolesPath}`;
}

function normalizeWordPressRole(raw = {}) {
  const slug = normalizeString(raw.slug || raw.key || raw.id || raw.name);
  const name = normalizeString(raw.name || raw.label || raw.displayName || raw.slug || slug);
  if (!slug) return null;
  return { slug, name: name || slug, description: normalizeString(raw.description), source: "wordpress" };
}

function normalizeWordPressRolesResponse(body) {
  const items = Array.isArray(body) ? body : Array.isArray(body?.roles) ? body.roles : Array.isArray(body?.data) ? body.data : Array.isArray(body?.items) ? body.items : [];
  return items.map(normalizeWordPressRole).filter(Boolean).sort((left, right) => left.name.localeCompare(right.name));
}

async function listWordPressRoles({ fetchImpl = fetch, config = getWordPressRolesConfig() } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const request = { method: "GET", url: buildRolesUrl(config) };
  try {
    const response = await fetchImpl(request.url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Basic ${Buffer.from(`${config.username}:${config.appPassword}`).toString("base64")}` },
      signal: controller.signal,
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; }
    catch (error) { throw new WordPressRolesError("WordPress roles endpoint returned invalid JSON", { status: response.status, body: text, code: "WORDPRESS_ROLES_INVALID_JSON", request, diagnostic: error.message }); }
    if (!response.ok) {
      const code = response.status === 401 ? "WORDPRESS_AUTHENTICATION_FAILED" : response.status === 403 ? "WORDPRESS_AUTHORIZATION_FAILED" : response.status === 404 ? "WORDPRESS_ROLES_ENDPOINT_NOT_FOUND" : "WORDPRESS_ROLES_REQUEST_FAILED";
      throw new WordPressRolesError("WordPress roles endpoint request failed", { status: response.status, body, code, request });
    }
    const roles = normalizeWordPressRolesResponse(body);
    if (!roles.length) throw new WordPressRolesError("WordPress roles endpoint returned an empty role catalog", { status: response.status, body, code: "WORDPRESS_ROLES_EMPTY", request });
    return roles;
  } catch (error) {
    if (error instanceof WordPressRolesError) throw error;
    if (error.name === "AbortError") throw new WordPressRolesError("WordPress roles endpoint timed out", { code: "WORDPRESS_ROLES_TIMEOUT", request });
    throw new WordPressRolesError("WordPress roles endpoint returned invalid data or could not be reached", { code: "WORDPRESS_ROLES_UNAVAILABLE", diagnostic: error.message, request });
  } finally {
    clearTimeout(timeout);
  }
}

async function listPersistedWordPressRoleMappings(database = db) {
  return database.select().from(wordpressRoleMappings);
}

function rowsToMapping(rows = []) {
  return Object.fromEntries(rows.filter((row) => row.logtoRoleId && isMappableRoleName(row.organizationRoleName)).map((row) => [row.logtoRoleId, {
    logtoRoleId: row.logtoRoleId,
    organizationRoleName: row.organizationRoleName,
    wordpressRoleSlug: row.wordpressRoleSlug || "",
    wordpressRoleName: row.wordpressRoleName || row.wordpressRoleSlug || "",
    isActive: row.isActive !== false,
    source: row.source || WORDPRESS_ROLE_MAPPING_SOURCES.GUI_OVERRIDE,
  }]));
}

function buildRoleIndexes(logtoRoles = []) {
  const roles = logtoRoles.map((role) => ({ logtoRoleId: getRoleId(role), organizationRoleName: getRoleName(role) })).filter((role) => role.logtoRoleId && isMappableRoleName(role.organizationRoleName));
  return { roles };
}

async function getEffectiveWordPressRoleMapping({ database = db, logtoRoles = [], persistedRows } = {}) {
  const roleIndexes = buildRoleIndexes(logtoRoles);
  const rows = Array.isArray(persistedRows) ? persistedRows : await listPersistedWordPressRoleMappings(database);
  const persisted = rowsToMapping(rows);
  const mapping = {};
  for (const role of roleIndexes.roles) {
    mapping[role.logtoRoleId] = persisted[role.logtoRoleId] || {
      logtoRoleId: role.logtoRoleId,
      organizationRoleName: role.organizationRoleName,
      wordpressRoleSlug: "",
      wordpressRoleName: "",
      isActive: false,
      source: WORDPRESS_ROLE_MAPPING_SOURCES.UNMAPPED,
    };
    mapping[role.logtoRoleId].organizationRoleName = role.organizationRoleName;
  }
  if (!roleIndexes.roles.length) Object.assign(mapping, persisted);
  return { mapping, source: Object.keys(persisted).length ? "database" : WORDPRESS_ROLE_MAPPING_SOURCES.UNMAPPED, warnings: [] };
}

function buildWordPressRoleMappingResponse({ logtoRoles = [], persistedRows = [], effective, wordpressRoles = [], roleCatalogWarning = null }) {
  const { roles } = buildRoleIndexes(logtoRoles);
  const persisted = rowsToMapping(persistedRows);
  const catalogBySlug = new Map(wordpressRoles.map((role) => [role.slug, role]));
  const mappingRoles = roles.length ? roles : Object.values(persisted).map((mapping) => ({ logtoRoleId: mapping.logtoRoleId, organizationRoleName: mapping.organizationRoleName }));
  const mappings = mappingRoles.map((role) => {
    const mapping = effective.mapping[role.logtoRoleId] || persisted[role.logtoRoleId] || { wordpressRoleSlug: "", wordpressRoleName: "", isActive: false, source: WORDPRESS_ROLE_MAPPING_SOURCES.UNMAPPED };
    const catalogRole = mapping.wordpressRoleSlug ? catalogBySlug.get(mapping.wordpressRoleSlug) : null;
    return {
      logtoRoleId: role.logtoRoleId,
      organizationRoleName: role.organizationRoleName,
      wordpressRoleSlug: mapping.wordpressRoleSlug || "",
      wordpressRoleName: catalogRole?.name || mapping.wordpressRoleName || mapping.wordpressRoleSlug || "",
      isActive: Boolean(mapping.wordpressRoleSlug) && mapping.isActive !== false,
      source: persisted[role.logtoRoleId]?.source || mapping.source || effective.source,
      isCustomized: Boolean(persisted[role.logtoRoleId]),
    };
  });
  return {
    roles: roles.map((role) => ({ id: role.logtoRoleId, name: role.organizationRoleName })),
    wordpressRoles,
    mappings,
    warnings: [...(effective.warnings || []), roleCatalogWarning].filter(Boolean),
    effectiveSource: effective.source,
    note: "WordPress roles are an operational synchronization target only. Logto remains canonical for Civitas roles, tenant context, permissions, and authorization.",
  };
}

async function loadWordPressRoleMappingReadModel({ database = db, listRoles, listWpRoles = listWordPressRoles, logger = console } = {}) {
  const roleLoader = typeof listRoles === "function" ? listRoles : async () => [];
  const [rolesResult, rowsResult, wpRolesResult] = await Promise.allSettled([roleLoader(), listPersistedWordPressRoleMappings(database), listWpRoles()]);
  const warnings = [];
  let logtoRoles = [];
  let persistedRows = [];
  let wordpressRoles = [];
  if (rolesResult.status === "fulfilled") logtoRoles = Array.isArray(rolesResult.value) ? rolesResult.value : [];
  else { logger.warn?.("Unable to load Logto organization roles for WordPress role mappings", rolesResult.reason); warnings.push("No se pudieron cargar los roles organizacionales desde Logto; se muestran mappings persistidos si existen."); }
  if (rowsResult.status === "fulfilled") persistedRows = rowsResult.value;
  else { logger.error?.("Unable to load persisted WordPress role mappings", rowsResult.reason); warnings.push(`No se pudieron cargar mappings WordPress persistidos desde PostgreSQL: ${rowsResult.reason?.message || rowsResult.reason}`); }
  let roleCatalogWarning = null;
  if (wpRolesResult.status === "fulfilled") wordpressRoles = wpRolesResult.value;
  else { logger.warn?.("Unable to load WordPress role catalog", wpRolesResult.reason); roleCatalogWarning = `No se pudo cargar el catálogo de roles WordPress: ${wpRolesResult.reason?.message || wpRolesResult.reason}`; }
  const effective = await getEffectiveWordPressRoleMapping({ database, logtoRoles, persistedRows });
  effective.warnings = [...warnings, ...(effective.warnings || [])];
  return buildWordPressRoleMappingResponse({ logtoRoles, persistedRows, effective, wordpressRoles, roleCatalogWarning });
}

async function upsertWordPressRoleMappings({ mappings = [], database = db, wordpressRoles = [] } = {}) {
  const now = new Date();
  const catalogBySlug = new Map(wordpressRoles.map((role) => [role.slug, role]));
  const rows = mappings.filter((item) => item.logtoRoleId && isMappableRoleName(item.organizationRoleName)).map((item) => {
    const slug = normalizeString(item.wordpressRoleSlug);
    const catalogRole = slug ? catalogBySlug.get(slug) : null;
    return {
      logtoRoleId: item.logtoRoleId,
      organizationRoleName: item.organizationRoleName,
      wordpressRoleSlug: slug,
      wordpressRoleName: catalogRole?.name || normalizeString(item.wordpressRoleName) || slug,
      isActive: Boolean(slug) && item.isActive !== false,
      source: WORDPRESS_ROLE_MAPPING_SOURCES.GUI_OVERRIDE,
      updatedAt: now,
    };
  });
  for (const row of rows) {
    await database.insert(wordpressRoleMappings).values({ ...row, createdAt: now }).onConflictDoUpdate({ target: wordpressRoleMappings.logtoRoleId, set: row });
  }
  return rows;
}

async function resetWordPressRoleMappings({ database = db } = {}) {
  await database.delete(wordpressRoleMappings);
}

module.exports = {
  WORDPRESS_ROLE_MAPPING_SOURCES,
  WordPressRolesError,
  buildWordPressRoleMappingResponse,
  getEffectiveWordPressRoleMapping,
  getWordPressRolesConfig,
  listWordPressRoles,
  loadWordPressRoleMappingReadModel,
  normalizeWordPressRolesResponse,
  resetWordPressRoleMappings,
  rowsToMapping,
  upsertWordPressRoleMappings,
};
