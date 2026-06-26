const { AUDIT_ACTIONS, AUDIT_RESULTS, recordAuditLogBestEffort } = require("./auditLogs");
const {
  DEFAULT_CRM_ROLE_MAPPINGS,
  getDatabaseErrorDiagnostic,
  getEffectiveCrmRoleMapping,
  parseEnvRoleMappings,
} = require("./crmRoleMappings");
const { FLUENTCRM_SYNC_STATUSES, markOrganizationProfileFluentCrmSync } = require("./organizationProfiles");

const SENSITIVE_KEY_PATTERN = /(authorization|password|app[_-]?password|secret|token|credential|cookie|api[_-]?key)/i;
const PROHIBITED_ROLE_NAMES = new Set(["owner_global"]);
const CRM_CLEANUP_STRATEGIES = Object.freeze({
  HARD_DELETE: "hard_delete",
  DISSOCIATE_ONLY: "dissociate_only",
  NO_CONTACT_FOUND: "no_contact_found",
  DUPLICATE_CONFLICT: "duplicate_conflict",
  PARTIAL: "partial",
  FAILED: "failed",
});
const DEFAULT_ROLE_SYNC_MAPPING = DEFAULT_CRM_ROLE_MAPPINGS;

function sanitizeForDiagnostics(value, depth = 0) {
  if (value == null) return value;
  if (depth > 4) return "[MaxDepth]";
  if (value instanceof Error) return { name: value.name, message: value.message, status: value.status, code: value.code };
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => sanitizeForDiagnostics(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, SENSITIVE_KEY_PATTERN.test(key) ? "[Redacted]" : sanitizeForDiagnostics(entry, depth + 1)]));
  }
  if (typeof value === "string") return value.length > 1000 ? `${value.slice(0, 1000)}…` : value;
  return value;
}

function sanitizePublicRequest(request) {
  if (!request || typeof request !== "object") return null;
  return {
    method: request.method || "GET",
    path: request.path || null,
  };
}

function sanitizePublicErrorBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const sanitized = {};
  if (typeof body.message === "string" && body.message) sanitized.message = body.message.length > 300 ? `${body.message.slice(0, 300)}…` : body.message;
  if (typeof body.status === "string" || Number.isInteger(body.status)) sanitized.status = body.status;
  if (typeof body.code === "string" && body.code) sanitized.code = body.code;
  if (Number.isInteger(body.timeoutMs)) sanitized.timeoutMs = body.timeoutMs;
  if (Array.isArray(body.missing) && body.missing.length > 0) sanitized.missing = body.missing.slice(0, 20);
  return Object.keys(sanitized).length ? sanitized : null;
}

class FluentCrmError extends Error {
  constructor(message, { status, body, code, diagnostic, request } = {}) {
    super(message);
    this.name = "FluentCrmError";
    this.status = status;
    this.body = sanitizePublicErrorBody(body);
    this.code = code;
    this.diagnostic = code ? sanitizeForDiagnostics(diagnostic) : null;
    this.request = sanitizePublicRequest(request);
    this.internalBody = sanitizeForDiagnostics(body);
    this.internalDiagnostic = diagnostic || null;
    this.internalRequest = request ? sanitizeForDiagnostics(request) : null;
  }
}

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch (error) {
    throw new FluentCrmError("FLUENTCRM_BASE_URL must be a valid absolute URL", { code: "FLUENTCRM_CONFIG_INVALID" });
  }
}

function getFluentCrmConfig() {
  const baseUrl = normalizeBaseUrl(process.env.FLUENTCRM_BASE_URL);
  const username = process.env.FLUENTCRM_USERNAME;
  const appPassword = process.env.FLUENTCRM_APP_PASSWORD;
  const missing = [];
  if (!baseUrl) missing.push("FLUENTCRM_BASE_URL");
  if (!username) missing.push("FLUENTCRM_USERNAME");
  if (!appPassword) missing.push("FLUENTCRM_APP_PASSWORD");
  if (missing.length) {
    throw new FluentCrmError(`FluentCRM is not configured; missing ${missing.join(", ")}`, { code: "FLUENTCRM_CONFIG_MISSING", body: { missing } });
  }
  const timeoutMs = Number.parseInt(process.env.FLUENTCRM_TIMEOUT_MS || "10000", 10);
  return { baseUrl, username, appPassword, timeoutMs: Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10000 };
}

function buildAuthHeader(config) {
  return `Basic ${Buffer.from(`${config.username}:${config.appPassword}`).toString("base64")}`;
}

function normalizeDomain(value) {
  if (!value) return null;
  const candidate = String(value).trim().toLowerCase();
  if (!candidate) return null;
  try {
    const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    return url.hostname.replace(/^www\./, "");
  } catch (error) {
    return candidate.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || null;
  }
}

function normalizeEmail(value) {
  return value ? String(value).trim().toLowerCase() || null : null;
}

function normalizeName(value) {
  return value ? String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() || null : null;
}

const normalizeString = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const cleanObject = (obj = {}) => Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== null && value !== undefined && value !== ""));
const normalizeStringList = (value) => Array.isArray(value) ? [...new Set(value.map(normalizeString).filter(Boolean))] : [];
const normalizeInteger = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};
const getSourceNumberOfEmployees = (source = {}) => source.civitasProfile?.business?.numberOfEmployees
  ?? source.crm?.numberOfEmployees
  ?? source.numberOfEmployees;

const buildStructuredAddress = (company = {}) => [
  company.addressLine1,
  company.addressLine2,
  company.city,
  company.state,
  company.postalCode,
  company.country,
].map(normalizeString).filter(Boolean).join(", ") || null;

function normalizeCrmCompanyInput(input = {}, fallback = {}) {
  const companyName = normalizeString(input.companyName ?? input.name) || normalizeString(fallback.name ?? fallback.nameCache);
  return {
    companyName,
    companyEmail: normalizeEmail(input.companyEmail ?? input.email),
    companyPhone: normalizeString(input.companyPhone ?? input.phone),
    website: normalizeString(input.website ?? fallback.website ?? fallback.adminDomain),
    address: normalizeString(input.address ?? input.billingAddress ?? input.companyAddress) || buildStructuredAddress(input),
    addressLine1: normalizeString(input.addressLine1),
    addressLine2: normalizeString(input.addressLine2),
    city: normalizeString(input.city),
    state: normalizeString(input.state ?? input.department),
    postalCode: normalizeString(input.postalCode ?? input.zip),
    country: normalizeString(input.country),
    numberOfEmployees: normalizeInteger(getSourceNumberOfEmployees(input)),
    industry: normalizeString(input.industry),
    type: normalizeString(input.type),
    companyOwner: normalizeString(input.companyOwner),
    about: normalizeString(input.about ?? input.description ?? input.companyDescription),
    description: normalizeString(input.description ?? input.about ?? input.companyDescription),
    nit: normalizeInteger(input.nit),
    verificationDigit: normalizeInteger(input.verificationDigit ?? input.digito_de_verificación ?? input.digito_de_verificacion),
    tags: normalizeStringList(input.tags),
    lists: normalizeStringList(input.lists),
  };
}

function buildFluentCrmCompanyPayload(company = {}) {
  const customValues = {};
  if (company.nit != null) customValues.nit = company.nit;
  if (company.verificationDigit != null) customValues["digito_de_verificación"] = company.verificationDigit;
  if (company.addressLine1) customValues.address_line_1 = company.addressLine1;
  if (company.addressLine2) customValues.address_line_2 = company.addressLine2;
  if (company.city) customValues.city = company.city;
  if (company.state) customValues.state = company.state;
  if (company.postalCode) customValues.postal_code = company.postalCode;
  if (company.country) customValues.country = company.country;
  const employeesNumber = normalizeInteger(getSourceNumberOfEmployees(company));
  if (employeesNumber != null) customValues.employees_number = employeesNumber;

  return {
    name: company.companyName || company.name || company.nameCache,
    email: company.companyEmail || company.email || company.billingEmail || company.contactEmail || undefined,
    phone: company.companyPhone || company.phone || undefined,
    website: company.website || company.adminDomain || undefined,
    address: company.address || buildStructuredAddress(company) || undefined,
    address_line_1: company.addressLine1 || undefined,
    address_line_2: company.addressLine2 || undefined,
    city: company.city || undefined,
    state: company.state || undefined,
    postal_code: company.postalCode || undefined,
    country: company.country || undefined,
    employees_number: employeesNumber ?? undefined,
    industry: company.industry || undefined,
    type: company.type || undefined,
    owner: company.companyOwner || undefined,
    description: company.description || company.about || undefined,
    about: company.about || company.description || undefined,
    ...(Array.isArray(company.tags) && company.tags.length > 0 ? { tags: company.tags } : {}),
    ...(Array.isArray(company.lists) && company.lists.length > 0 ? { lists: company.lists } : {}),
    ...(Object.keys(customValues).length > 0 ? { custom_values: customValues } : {}),
  };
}


const COMPANY_SYNC_FIELDS = Object.freeze([
  "name",
  "email",
  "phone",
  "website",
  "address",
  "address_line_1",
  "address_line_2",
  "city",
  "state",
  "postal_code",
  "country",
  "employees_number",
  "industry",
  "type",
  "owner",
  "description",
  "about",
  "tags",
  "lists",
  "custom_values.nit",
  "custom_values.digito_de_verificación",
  "custom_values.address_line_1",
  "custom_values.address_line_2",
  "custom_values.city",
  "custom_values.state",
  "custom_values.postal_code",
  "custom_values.country",
  "custom_values.employees_number",
]);

const comparableValue = (value) => {
  if (value == null || value === "") return null;
  if (Array.isArray(value)) return value.map((item) => normalizeString(item)).filter(Boolean).sort();
  if (typeof value === "number") return value;
  return normalizeString(value);
};

function getByPath(object, path) {
  return path.split(".").reduce((current, key) => current && current[key] !== undefined ? current[key] : undefined, object);
}

function setByPath(object, path, value) {
  const keys = path.split(".");
  let current = object;
  keys.slice(0, -1).forEach((key) => {
    if (!current[key] || typeof current[key] !== "object" || Array.isArray(current[key])) current[key] = {};
    current = current[key];
  });
  current[keys[keys.length - 1]] = value;
}

function normalizeExistingCompanyForDiff(company = {}) {
  const custom = company.custom_values || company.customValues || {};
  return {
    name: companyName(company),
    email: companyEmail(company),
    phone: company.phone || company.company_phone || null,
    website: companyWebsite(company),
    address: company.address || company.billing_address || null,
    address_line_1: company.address_line_1 || custom.address_line_1 || null,
    address_line_2: company.address_line_2 || custom.address_line_2 || null,
    city: company.city || custom.city || null,
    state: company.state || company.region || custom.state || null,
    postal_code: company.postal_code || company.zip || custom.postal_code || null,
    country: company.country || custom.country || null,
    employees_number: normalizeInteger(company.employees_number ?? custom.employees_number),
    industry: company.industry || null,
    type: company.type || null,
    owner: company.owner || company.company_owner || null,
    description: company.description || null,
    about: company.about || null,
    tags: company.tags || [],
    lists: company.lists || [],
    custom_values: {
      nit: normalizeInteger(custom.nit),
      "digito_de_verificación": normalizeInteger(custom["digito_de_verificación"] ?? custom.digito_de_verificacion),
      address_line_1: custom.address_line_1 || company.address_line_1 || null,
      address_line_2: custom.address_line_2 || company.address_line_2 || null,
      city: custom.city || company.city || null,
      state: custom.state || company.state || company.region || null,
      postal_code: custom.postal_code || company.postal_code || company.zip || null,
      country: custom.country || company.country || null,
      employees_number: normalizeInteger(custom.employees_number ?? company.employees_number),
    },
  };
}

function computeCompanyFieldDiffs(desiredPayload = {}, existingCompany = {}) {
  const existing = normalizeExistingCompanyForDiff(existingCompany);
  const fieldDiffs = {};
  const patch = {};
  for (const field of COMPANY_SYNC_FIELDS) {
    const desired = getByPath(desiredPayload, field);
    if (desired === undefined) continue;
    const before = comparableValue(getByPath(existing, field));
    const after = comparableValue(desired);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      fieldDiffs[field] = { before, after };
      setByPath(patch, field, desired);
    }
  }
  return { fieldDiffs, patch, fieldsSent: Object.keys(fieldDiffs) };
}

function getMissingCompanyPayloadFields(payload = {}) {
  return ["name"].filter((field) => !payload[field]);
}

async function updateCompany(companyIdValue, fields = {}) {
  const body = await requestFluentCrm(`/companies/${encodeURIComponent(companyIdValue)}`, { method: "PUT", body: fields });
  return extractCompanies(body)[0] || body;
}

function companyId(company) {
  return company?.id ?? company?.ID ?? company?.company_id ?? null;
}

function companyWebsite(company) {
  return company?.website ?? company?.url ?? company?.company_url ?? null;
}

function companyEmail(company) {
  return company?.email ?? company?.company_email ?? null;
}

function companyName(company) {
  return company?.name ?? company?.title ?? company?.company_name ?? null;
}

function extractCompanies(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.companies)) return body.companies;
  if (Array.isArray(body?.data)) return body.data;
  if (body && typeof body === "object" && companyId(body)) return [body];
  return [];
}

function flattenDiagnosticText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenDiagnosticText).join(" ");
  if (typeof value === "object") return Object.values(value).map(flattenDiagnosticText).join(" ");
  return String(value);
}

function summarizeValidationErrors(parsed) {
  const errors = parsed && typeof parsed === "object" && parsed.errors && typeof parsed.errors === "object" ? parsed.errors : null;
  if (!errors) return null;
  const entries = Object.entries(errors)
    .map(([field, messages]) => {
      const text = flattenDiagnosticText(messages).trim();
      return text ? `${field}: ${text}` : field;
    })
    .filter(Boolean);
  return entries.length ? entries.join("; ") : null;
}

function describeValidationTarget(path) {
  if (path === "/subscribers") return "contacto/subscriber";
  if (path === "/companies") return "compañía";
  return `recurso ${path}`;
}
function classifyFluentCrmValidationError(parsed, path) {
  const text = flattenDiagnosticText(parsed).toLowerCase();
  const likelyCauses = [];
  if (/duplicate|already exists|already exist|email.*taken|unique|subscriber.*exists|contact.*exists/.test(text)) likelyCauses.push("duplicate_email");
  if (/company[_ -]?id|company/.test(text)) likelyCauses.push("invalid_company_id");
  if (/tag|tags/.test(text)) likelyCauses.push("invalid_tag");
  if (/list|lists/.test(text)) likelyCauses.push("invalid_list");
  if (/email|first_name|last_name|full_name|phone|required|invalid|required field|validation/.test(text)) likelyCauses.push("invalid_payload");
  const fieldSummary = summarizeValidationErrors(parsed);
  const responseMessage = typeof parsed?.message === "string" && parsed.message.trim() ? parsed.message.trim() : null;
  const target = describeValidationTarget(path);
  const detail = fieldSummary || responseMessage || "FluentCRM no devolvió detalle por campo; revisa email, nombre, teléfono, company_id, tags y lists enviados.";
  return {
    code: likelyCauses.includes("duplicate_email") ? "FLUENTCRM_DUPLICATE_CONTACT" : "FLUENTCRM_VALIDATION_FAILED",
    message: `FluentCRM rechazó el payload de ${target} en ${path} con error de validación (422). Detalle: ${detail}`,
    likelyCauses: [...new Set(likelyCauses.length ? likelyCauses : ["invalid_payload"])],
    validationTarget: target,
    validationDetail: detail,
    fieldErrors: parsed?.errors && typeof parsed.errors === "object" ? sanitizeForDiagnostics(parsed.errors) : null,
    fluentCrmError: sanitizeForDiagnostics(parsed),
  };
}

function getFluentCrmDiagnostic(response, parsed, path) {
  if (response.status === 401) return { code: "FLUENTCRM_AUTHENTICATION_FAILED", message: "FluentCRM authentication failed (401). Verify FLUENTCRM_USERNAME and FLUENTCRM_APP_PASSWORD are a valid WordPress Application Password for the configured site.", likelyCauses: ["invalid_username", "invalid_application_password", "basic_auth_blocked", "wrong_base_url_or_site"] };
  if (response.status === 403) return { code: "FLUENTCRM_AUTHORIZATION_FAILED", message: "FluentCRM authorization failed (403). The WordPress user authenticated, but does not have permission to access FluentCRM REST endpoints.", likelyCauses: ["wordpress_user_lacks_fluentcrm_permissions", "security_plugin_blocks_rest_api"] };
  if (response.status === 404) return { code: "FLUENTCRM_ENDPOINT_NOT_FOUND", message: `FluentCRM endpoint was not found at /wp-json/fluent-crm/v2${path}. Verify FLUENTCRM_BASE_URL and that FluentCRM is installed and REST API endpoints are enabled.`, likelyCauses: ["wrong_base_url", "fluentcrm_plugin_missing_or_inactive", "rest_route_unavailable"] };
  if (response.status === 422) return classifyFluentCrmValidationError(parsed, path);
  return { code: "FLUENTCRM_REQUEST_FAILED", message: `FluentCRM request failed (${response.status})`, likelyCauses: [] };
}

async function requestFluentCrm(path, { method = "GET", query, body } = {}) {
  const config = getFluentCrmConfig();
  const url = new URL(`${config.baseUrl}/wp-json/fluent-crm/v2${path}`);
  if (query) Object.entries(query).forEach(([key, value]) => value != null && url.searchParams.set(key, value));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: buildAuthHeader(config) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new FluentCrmError(`FluentCRM request timed out after ${config.timeoutMs}ms`, { status: 504, code: "FLUENTCRM_TIMEOUT", diagnostic: { timeoutMs: config.timeoutMs, path }, request: { method, path } });
    throw new FluentCrmError("FluentCRM network request failed", { status: 502, code: "FLUENTCRM_NETWORK_ERROR", body: error, request: { method, path } });
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new FluentCrmError("FluentCRM returned invalid JSON", { status: response.status, body: { responseBody: text }, code: "FLUENTCRM_INVALID_JSON", request: { method, path } });
    }
  }
  if (!response.ok) {
    const diagnostic = getFluentCrmDiagnostic(response, parsed, path);
    throw new FluentCrmError(diagnostic.message, { status: response.status, body: parsed, code: diagnostic.code, diagnostic, request: { method, path } });
  }
  return parsed;
}

async function searchCompanies({ search, email, website, companyId: id, perPage = 20 } = {}) {
  if (id) {
    try { return extractCompanies(await requestFluentCrm(`/companies/${encodeURIComponent(id)}`)); } catch (error) { if (error.status !== 404) throw error; return []; }
  }
  const query = { per_page: perPage, search: search || email || website || undefined };
  return extractCompanies(await requestFluentCrm("/companies", { query }));
}

async function findCompanyCandidates(organization = {}) {
  const seen = new Map();
  const add = (company, source) => {
    const id = companyId(company) || JSON.stringify(company);
    seen.set(String(id), { company, sources: [...new Set([...(seen.get(String(id))?.sources || []), source])] });
  };
  if (organization.fluentcrmCompanyId) (await searchCompanies({ companyId: organization.fluentcrmCompanyId })).forEach((c) => add(c, "fluentcrm_company_id"));
  const domain = normalizeDomain(organization.website || organization.adminDomain || organization.domain);
  if (domain) (await searchCompanies({ website: domain })).forEach((c) => add(c, "domain"));
  const email = normalizeEmail(organization.companyEmail || organization.email || organization.billingEmail || organization.contactEmail);
  if (email) (await searchCompanies({ email })).forEach((c) => add(c, "email"));
  const name = normalizeName(organization.companyName || organization.name || organization.nameCache);
  if (name) (await searchCompanies({ search: organization.companyName || organization.name || organization.nameCache })).forEach((c) => add(c, "name"));
  return [...seen.values()].map(({ company, sources }) => ({ company, sources }));
}

function findReliableCompanyMatch(organization = {}, candidates = []) {
  if (organization.fluentcrmCompanyId) {
    const matches = candidates.filter(({ company }) => String(companyId(company)) === String(organization.fluentcrmCompanyId));
    if (matches.length === 1) return { status: "matched", company: matches[0].company, reason: "fluentcrm_company_id" };
  }
  const domain = normalizeDomain(organization.website || organization.adminDomain || organization.domain);
  const email = normalizeEmail(organization.companyEmail || organization.email || organization.billingEmail || organization.contactEmail);
  const name = normalizeName(organization.companyName || organization.name || organization.nameCache);
  const byDomain = domain ? candidates.filter(({ company }) => normalizeDomain(companyWebsite(company)) === domain) : [];
  if (byDomain.length === 1) return { status: "matched", company: byDomain[0].company, reason: "domain" };
  if (byDomain.length > 1) return { status: "conflict", reason: "duplicate_domain", candidates: byDomain.map(({ company }) => company) };
  const byEmail = email ? candidates.filter(({ company }) => normalizeEmail(companyEmail(company)) === email) : [];
  if (byEmail.length === 1) return { status: "matched", company: byEmail[0].company, reason: "email" };
  if (byEmail.length > 1) return { status: "conflict", reason: "duplicate_email", candidates: byEmail.map(({ company }) => company) };
  const byName = name ? candidates.filter(({ company }) => normalizeName(companyName(company)) === name) : [];
  if (byName.length === 1) return { status: "matched", company: byName[0].company, reason: "name" };
  if (byName.length > 1) return { status: "conflict", reason: "duplicate_name", candidates: byName.map(({ company }) => company) };
  return { status: "not_found" };
}

async function createCompany(organization = {}) {
  const payload = buildFluentCrmCompanyPayload(organization);
  const body = await requestFluentCrm("/companies", { method: "POST", body: payload });
  return extractCompanies(body)[0] || body;
}

async function searchFluentCrmCollection(path, { search } = {}) {
  const body = await requestFluentCrm(path, { query: { search, per_page: 50 } });
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.tags)) return body.tags;
  if (Array.isArray(body?.lists)) return body.lists;
  return [];
}

const itemName = (item = {}) => item.title || item.name || item.label || null;
const itemId = (item = {}) => item.id ?? item.ID ?? item.term_id ?? null;

async function ensureFluentCrmCollectionItem(path, { title, slug }) {
  const existing = await searchFluentCrmCollection(path, { search: title });
  const match = existing.find((item) => itemName(item) === title || item.slug === slug);
  if (match) return { item: match, created: false };
  const item = await requestFluentCrm(path, { method: "POST", body: { title, name: title, slug } });
  return { item, created: true };
}

function buildOrganizationCrmTaxonomy({ logtoOrganizationId, slug, name }) {
  const safeSlug = normalizeName(slug || name || logtoOrganizationId || "organization")?.replace(/\s+/g, "-") || "organization";
  const title = name || safeSlug;
  return {
    tag: { title, slug: safeSlug },
    list: { title, slug: safeSlug },
  };
}

async function ensureOrganizationTagsAndLists({ logtoOrganizationId, slug, name }) {
  const taxonomy = buildOrganizationCrmTaxonomy({ logtoOrganizationId, slug, name });
  const [tag, list] = await Promise.all([
    ensureFluentCrmCollectionItem("/tags", taxonomy.tag),
    ensureFluentCrmCollectionItem("/lists", taxonomy.list),
  ]);
  return {
    tag: { ...tag, id: itemId(tag.item), title: itemName(tag.item) || taxonomy.tag.title, slug: tag.item?.slug || taxonomy.tag.slug },
    list: { ...list, id: itemId(list.item), title: itemName(list.item) || taxonomy.list.title, slug: list.item?.slug || taxonomy.list.slug },
    persistence: "not_persisted_locally_recomputed_from_logto_organization_id_slug_or_name",
  };
}

function contactExternalId(contact = {}) {
  return contact.external_id ?? contact.externalId ?? contact.custom_values?.external_id ?? contact.meta?.external_id ?? null;
}

function contactEmail(contact = {}) {
  return normalizeEmail(contact.email ?? contact.primary_email ?? contact.primaryEmail);
}

function extractContacts(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.subscribers)) return body.subscribers;
  if (Array.isArray(body?.contacts)) return body.contacts;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

async function searchContacts({ email, externalId } = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (externalId) {
    const body = await requestFluentCrm("/subscribers", { query: { search: externalId, per_page: 20 } });
    const matches = extractContacts(body).filter((contact) => String(contactExternalId(contact) || "") === String(externalId));
    if (matches.length > 0) return matches;
  }
  if (!normalizedEmail) return [];
  const body = await requestFluentCrm("/subscribers", { query: { search: normalizedEmail, per_page: 20 } });
  return extractContacts(body).filter((contact) => contactEmail(contact) === normalizedEmail);
}

async function validateFluentCrmConfiguration() {
  const config = getFluentCrmConfig();
  await requestFluentCrm("/subscribers", { query: { per_page: 1 } });
  return { status: "ok", baseUrl: config.baseUrl, endpoint: `${config.baseUrl}/wp-json/fluent-crm/v2`, timeoutMs: config.timeoutMs };
}

const contactId = (contact = {}) => contact.id ?? contact.ID ?? contact.subscriber_id ?? null;
const contactCompanyId = (contact = {}) => contact.company_id ?? contact.companyId ?? contact.company?.id ?? contact.company?.ID ?? null;
const collectionNames = (items) => Array.isArray(items) ? items.map((item) => itemName(item) || item.title || item.name || item).filter(Boolean) : [];

async function deleteContact(contactIdentifier) {
  const id = typeof contactIdentifier === "object" ? contactId(contactIdentifier) : contactIdentifier;
  if (!id) throw new FluentCrmError("Cannot delete FluentCRM contact without an id", { code: "FLUENTCRM_CONTACT_ID_MISSING" });
  return requestFluentCrm(`/subscribers/${encodeURIComponent(id)}`, { method: "DELETE" });
}

async function updateContact(contactIdentifier, fields = {}) {
  const id = typeof contactIdentifier === "object" ? contactId(contactIdentifier) : contactIdentifier;
  if (!id) throw new FluentCrmError("Cannot update FluentCRM contact without an id", { code: "FLUENTCRM_CONTACT_ID_MISSING" });
  return requestFluentCrm(`/subscribers/${encodeURIComponent(id)}`, { method: "PUT", body: fields });
}

function getConfiguredCleanupMode() {
  const mode = (process.env.FLUENTCRM_CONTACT_CLEANUP_STRATEGY || "dissociate_only").trim().toLowerCase();
  return mode === "hard_delete" ? "hard_delete" : "dissociate_only";
}

function buildCleanupPolicy({ sharedOrganizationCount = 0 } = {}) {
  const configuredMode = getConfiguredCleanupMode();
  const isShared = Number(sharedOrganizationCount) > 0;
  return {
    configuredMode,
    strategy: configuredMode === "hard_delete" && !isShared ? CRM_CLEANUP_STRATEGIES.HARD_DELETE : CRM_CLEANUP_STRATEGIES.DISSOCIATE_ONLY,
    reason: isShared
      ? "contact_may_belong_to_other_logto_organizations"
      : configuredMode === "hard_delete"
        ? "hard_delete_enabled_and_no_other_logto_memberships_detected"
        : "default_conservative_policy_preserves_crm_identity_but_removes_organization_associations",
    tradeoff: "Civitas never treats CRM cleanup as permission authority; Logto remains canonical for identity, roles, and memberships. Dissociation avoids deleting data that may belong to another organization.",
  };
}

async function cleanupContactInFluentCrm({
  identity = {},
  profile = {},
  organization = {},
  remainingOrganizationIds = [],
} = {}) {
  const logtoUserId = identity.logtoUserId || identity.id || identity.userId || identity.sub || null;
  const email = normalizeEmail(identity.email || identity.primaryEmail || identity.profile?.email);
  const contacts = await searchContacts({ email, externalId: logtoUserId });
  const taxonomy = buildOrganizationCrmTaxonomy({ logtoOrganizationId: profile.logtoOrganizationId || organization.logtoOrganizationId, slug: profile.slug || organization.slug, name: profile.nameCache || organization.name });
  const policy = buildCleanupPolicy({ sharedOrganizationCount: remainingOrganizationIds.length });
  const base = {
    logtoUserId,
    contactMatched: contacts.length,
    fluentcrmCompanyId: profile.fluentcrmCompanyId || null,
    policy,
    organizationTaxonomy: taxonomy,
    remainingOrganizationIds,
    persistencePolicy: "audit_and_summary_only_no_contact_profile_replication",
  };

  if (contacts.length === 0) return { ...base, status: "completed", strategy: CRM_CLEANUP_STRATEGIES.NO_CONTACT_FOUND, message: "No FluentCRM contact matched the Logto user id or Logto email." };
  if (contacts.length > 1) return { ...base, status: "failed", strategy: CRM_CLEANUP_STRATEGIES.DUPLICATE_CONFLICT, candidateCount: contacts.length, message: "Multiple FluentCRM contacts matched; Civitas did not delete or mutate any contact." };

  const contact = contacts[0];
  const operations = [];
  if (policy.strategy === CRM_CLEANUP_STRATEGIES.HARD_DELETE) {
    await deleteContact(contact);
    return { ...base, status: "completed", strategy: CRM_CLEANUP_STRATEGIES.HARD_DELETE, contactId: contactId(contact), operations: [{ type: "hard_delete", status: "success" }], message: "Contact deleted in FluentCRM because hard delete is explicitly enabled and no other Logto organization memberships were detected." };
  }

  const currentTagNames = collectionNames(contact.tags);
  const currentListNames = collectionNames(contact.lists);
  const legacyTaxonomy = {
    tagTitle: `Civitas Organization: ${taxonomy.tag.title}`,
    tagSlug: `civitas-org-${taxonomy.tag.slug}`,
    listTitle: `Civitas ${taxonomy.list.title}`,
    listSlug: `civitas-${taxonomy.list.slug}`,
  };
  const organizationTagNames = new Set([taxonomy.tag.title, taxonomy.tag.slug, legacyTaxonomy.tagTitle, legacyTaxonomy.tagSlug]);
  const organizationListNames = new Set([taxonomy.list.title, taxonomy.list.slug, legacyTaxonomy.listTitle, legacyTaxonomy.listSlug]);
  const nextTags = currentTagNames.filter((name) => !organizationTagNames.has(name));
  const nextLists = currentListNames.filter((name) => !organizationListNames.has(name));
  const ownsCompany = profile.fluentcrmCompanyId && String(contactCompanyId(contact)) === String(profile.fluentcrmCompanyId);
  const payload = {
    ...(ownsCompany ? { company_id: null } : {}),
    tags: nextTags,
    lists: nextLists,
    status: "unsubscribed",
  };

  try {
    const updated = await updateContact(contact, payload);
    operations.push({ type: "dissociate_company", status: ownsCompany ? "success" : "skipped", reason: ownsCompany ? "matched_organization_company" : "contact_not_linked_to_this_company" });
    operations.push({ type: "remove_organization_tags", status: "success", removed: currentTagNames.filter((name) => !nextTags.includes(name)) });
    operations.push({ type: "remove_organization_lists", status: "success", removed: currentListNames.filter((name) => !nextLists.includes(name)) });
    operations.push({ type: "unsubscribe", status: "success" });
    return { ...base, status: "completed", strategy: CRM_CLEANUP_STRATEGIES.DISSOCIATE_ONLY, contactId: contactId(contact), operations, updated, message: "Contact was not claimed as deleted; Civitas removed only this organization's CRM associations and unsubscribed the contact." };
  } catch (error) {
    operations.push({ type: "dissociate_only", status: "failed", message: error.message });
    return { ...base, status: "failed", strategy: CRM_CLEANUP_STRATEGIES.FAILED, contactId: contactId(contact), operations, message: error.message, error };
  }
}

async function updateContactEmailAfterLogtoChange({ previousEmail, newEmail, logtoUserId, organizationId, logtoOrganizationId, profile = {} } = {}) {
  const contacts = await searchContacts({ email: previousEmail, externalId: logtoUserId });
  if (contacts.length > 1) throw new FluentCrmError("Ambiguous FluentCRM contact match for identity update", { code: "FLUENTCRM_CONTACT_CONFLICT", body: { candidateCount: contacts.length, logtoUserId, organizationId, logtoOrganizationId } });
  const contact = contacts[0];
  if (!contact) return { status: "not_found", previousEmail, newEmail, logtoUserId, organizationId, logtoOrganizationId };
  const customValues = {};
  if (process.env.FLUENTCRM_PREVIOUS_EMAIL_FIELD_KEY) customValues[process.env.FLUENTCRM_PREVIOUS_EMAIL_FIELD_KEY] = previousEmail;
  const updated = await updateContact(contact, {
    email: normalizeEmail(newEmail),
    full_name: normalizeString(profile.name),
    phone: normalizeString(profile.phone),
    custom_values: Object.keys(customValues).length ? customValues : undefined,
  });
  return { status: "updated", contact: updated, previousEmailAuditedOnly: !process.env.FLUENTCRM_PREVIOUS_EMAIL_FIELD_KEY };
}

function getFluentCrmRoleSyncMapping() {
  const env = parseEnvRoleMappings(console);
  return Object.keys(env.mapping).length ? { ...DEFAULT_ROLE_SYNC_MAPPING, ...env.mapping } : DEFAULT_ROLE_SYNC_MAPPING;
}

function normalizeRoleReference(role) {
  if (typeof role === "string") return { logtoRoleId: null, organizationRoleName: role };
  return {
    logtoRoleId: role?.logtoRoleId || role?.id || role?.organizationRoleId || role?.roleId || null,
    organizationRoleName: role?.organizationRoleName || role?.name || role?.nameCache || role?.key || null,
  };
}

function mapOrganizationRolesToCrmTaxonomy(roleNames = [], mapping = getFluentCrmRoleSyncMapping()) {
  const tags = new Set();
  const lists = new Set();
  const excludedRoles = [];
  const unmappedRoles = [];
  const mappedRoles = [];
  for (const role of roleNames) {
    const roleRef = normalizeRoleReference(role);
    const roleName = roleRef.organizationRoleName;
    if (PROHIBITED_ROLE_NAMES.has(roleName)) {
      excludedRoles.push(roleName);
      continue;
    }
    const mapped = (roleRef.logtoRoleId && mapping[roleRef.logtoRoleId]) || (roleName && mapping[roleName]);
    if (!mapped || mapped.isActive === false) {
      unmappedRoles.push(roleRef.logtoRoleId || roleName);
      continue;
    }
    mappedRoles.push({ logtoRoleId: roleRef.logtoRoleId || mapped.logtoRoleId || null, roleName: roleName || mapped.organizationRoleName || null, roleType: mapped.roleType || "organizational" });
    (mapped.tags || []).forEach((tag) => tags.add(tag));
    (mapped.lists || []).forEach((list) => lists.add(list));
  }
  return { tags: [...tags], lists: [...lists], mappedRoles, unmappedRoles, excludedRoles, note: "CRM tags/lists are communication segmentation only; Logto roles remain the permission source." };
}

async function createContact(fields = {}) {
  return requestFluentCrm("/subscribers", { method: "POST", body: fields });
}

function splitContactName(identity = {}) {
  const firstName = normalizeString(identity.firstName ?? identity.givenName ?? identity.primerNombre);
  const middleName = normalizeString(identity.middleName ?? identity.segundoNombre);
  const lastName = normalizeString(identity.lastName ?? identity.familyName ?? identity.firstSurname ?? identity.primerApellido);
  const secondSurname = normalizeString(identity.secondSurname ?? identity.segundoApellido);
  if (firstName || lastName) return { firstName: [firstName, middleName].filter(Boolean).join(" ") || null, lastName: [lastName, secondSurname].filter(Boolean).join(" ") || null };
  const parts = normalizeString(identity.name)?.split(/\s+/).filter(Boolean) || [];
  if (parts.length <= 1) return { firstName: parts[0] || null, lastName: null };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

function summarizeContactPayload(payload = {}) {
  return {
    email: payload.email || null,
    first_name: payload.first_name || null,
    last_name: payload.last_name || null,
    phone: payload.phone || null,
    company_id: payload.company_id ?? null,
    tags: payload.tags || [],
    lists: payload.lists || [],
    customValueKeys: Object.keys(payload.custom_values || {}),
  };
}

function getMissingContactPayloadFields(payload = {}) {
  return ["first_name", "last_name", "email", "phone", "company_id", "tags", "lists"].filter((field) => {
    const value = payload[field];
    if (Array.isArray(value)) return value.length === 0;
    return value === undefined || value === null || value === "";
  });
}

function buildContactIdentifiers(identity = {}) {
  return JSON.stringify(cleanObject({
    logto_user_id: identity.logtoUserId || null,
    logto_id_organization: identity.logtoOrganizationId || identity.organizationId || null,
    email: normalizeEmail(identity.email),
    username: normalizeString(identity.username),
  }));
}

function buildFluentCrmContactPayload({ identity = {}, companyId = null, roleNames = [], extraTags = [], extraLists = [], roleMapping = getFluentCrmRoleSyncMapping(), existingContact = null } = {}) {
  const email = normalizeEmail(identity.email);
  const { firstName, lastName } = splitContactName(identity);
  const displayName = normalizeString(identity.name) || [firstName, lastName].filter(Boolean).join(" ") || null;
  const taxonomy = mapOrganizationRolesToCrmTaxonomy(roleNames, roleMapping);
  const tags = [...new Set([...taxonomy.tags, ...normalizeStringList(extraTags)])];
  const lists = [...new Set([...taxonomy.lists, ...normalizeStringList(extraLists)])];
  const previousEmail = normalizeEmail(identity.previousEmailAddress ?? identity.previousEmail) || (existingContact && contactEmail(existingContact) !== email ? contactEmail(existingContact) : null);
  const roleValue = [...new Set([...(taxonomy.mappedRoles || []).map((role) => role.roleName).filter(Boolean), ...roleNames.map((role) => normalizeRoleReference(role).organizationRoleName).filter(Boolean)])].join(", ") || null;
  const customValues = cleanObject({
    profile_display_name: displayName,
    username: normalizeString(identity.username),
    user_role: roleValue,
    previous_email_address: previousEmail,
    logto_user_id: identity.logtoUserId || null,
    logto_id_organization: identity.logtoOrganizationId || identity.organizationId || null,
    last_login: normalizeString(identity.lastLoginAt ?? identity.lastLogin),
    identifiers: buildContactIdentifiers(identity),
    ...(normalizeString(identity.position) ? { cargo: normalizeString(identity.position) } : {}),
    ...(normalizeString(identity.phoneExtension) ? { phone_extension: normalizeString(identity.phoneExtension) } : {}),
  });
  const payload = {
    first_name: firstName || undefined,
    last_name: lastName || undefined,
    email,
    phone: normalizeString(identity.phone),
    company_id: companyId,
    tags,
    lists,
    full_name: displayName || undefined,
    job_title: normalizeString(identity.position),
    external_id: identity.logtoUserId || undefined,
    custom_values: customValues,
  };
  if (Object.keys(payload.custom_values || {}).length === 0) delete payload.custom_values;
  return { payload, taxonomy, summary: summarizeContactPayload(payload), fieldsSent: Object.keys(payload).filter((key) => payload[key] !== undefined), missingFields: getMissingContactPayloadFields(payload) };
}

async function upsertContactFromLogtoIdentity({ identity, companyId, roleNames = [], extraTags = [], extraLists = [], roleMapping = getFluentCrmRoleSyncMapping() }) {
  const email = normalizeEmail(identity.email);
  if (!email) return { status: "error", reason: "missing_email", logtoUserId: identity.logtoUserId || null, payloadSummary: null, fieldsSent: [], missingFields: ["email"] };
  const contacts = await searchContacts({ email, externalId: identity.logtoUserId });
  if (contacts.length > 1) return { status: "conflict", reason: "duplicate_contact", email, logtoUserId: identity.logtoUserId || null, candidateCount: contacts.length };
  const existingContact = contacts[0] || null;
  const { payload, taxonomy, summary, fieldsSent, missingFields } = buildFluentCrmContactPayload({ identity, companyId, roleNames, extraTags, extraLists, roleMapping, existingContact });
  try {
    const contact = existingContact ? await updateContact(existingContact, payload) : await createContact(payload);
    return { status: existingContact ? "updated" : "created", contact, email, logtoUserId: identity.logtoUserId || null, taxonomy, payloadSummary: summary, fieldsSent, missingFields };
  } catch (error) {
    error.crmContactSync = { status: "error", reason: "crm_request_failed", email, logtoUserId: identity.logtoUserId || null, payloadSummary: summary, fieldsSent, missingFields, code: error.code || null, fluentCrmStatus: error.status || null, message: error.message };
    throw error;
  }
}

async function syncOrganizationContactsToFluentCrm({ profile, members, getMemberRoles, roleMapping = null, audit = async () => {}, markOrganizationSync = async () => {} }) {
  if (!profile?.fluentcrmCompanyId) {
    const summary = { status: "error", reason: "company_not_linked", total: members.length, succeeded: 0, failed: members.length, conflicts: 0, errors: [{ reason: "company_not_linked" }] };
    await markOrganizationSync(summary);
    await audit({ result: "error", summary });
    return summary;
  }
  let effectiveRoleMapping = roleMapping;
  if (!effectiveRoleMapping) {
    try {
      effectiveRoleMapping = (await getEffectiveCrmRoleMapping()).mapping;
    } catch (error) {
      console.warn("Falling back to legacy/default FluentCRM role mapping because persisted mapping could not be loaded", { diagnostic: getDatabaseErrorDiagnostic(error), error });
      effectiveRoleMapping = getFluentCrmRoleSyncMapping();
    }
  }
  const results = [];
  for (const member of members) {
    const identity = {
      logtoUserId: member.id || member.userId || member.logtoUserId || member.sub || null,
      email: member.primaryEmail || member.email || member.profile?.email || null,
      previousEmail: member.previousEmail || member.previousEmailAddress || null,
      name: member.name || member.profile?.name || null,
      firstName: member.firstName || member.givenName || member.profile?.givenName || null,
      middleName: member.middleName || member.profile?.middleName || null,
      lastName: member.lastName || member.familyName || member.profile?.familyName || null,
      username: member.username || member.profile?.preferredUsername || null,
      phone: member.primaryPhone || member.phone || member.profile?.phone || null,
      logtoOrganizationId: profile.logtoOrganizationId || null,
      lastLoginAt: member.lastLoginAt || member.lastSignInAt || null,
    };
    try {
      const roleNames = await getMemberRoles(identity.logtoUserId);
      const result = await upsertContactFromLogtoIdentity({ identity, companyId: profile.fluentcrmCompanyId, roleNames, roleMapping: effectiveRoleMapping });
      results.push(result);
      await audit({ result: result.status === "conflict" || result.status === "error" ? "error" : "success", member: { logtoUserId: identity.logtoUserId, email: identity.email }, syncResult: result });
    } catch (error) {
      const result = error.crmContactSync || { status: "error", reason: "crm_request_failed", logtoUserId: identity.logtoUserId, email: identity.email, message: error.message, code: error.code || null, fluentCrmStatus: error.status || null };
      results.push(result);
      await audit({ result: "error", member: { logtoUserId: identity.logtoUserId, email: identity.email }, syncResult: result, error });
    }
  }
  const summary = {
    status: results.some((item) => item.status === "conflict") ? "conflict" : results.some((item) => item.status === "error") ? "partial_error" : "synced",
    total: members.length,
    succeeded: results.filter((item) => ["created", "updated"].includes(item.status)).length,
    failed: results.filter((item) => item.status === "error").length,
    conflicts: results.filter((item) => item.status === "conflict").length,
    errors: results.filter((item) => item.status === "error" || item.status === "conflict").map((item) => ({ logtoUserId: item.logtoUserId, email: item.email, reason: item.reason, message: item.message, code: item.code || null, fluentCrmStatus: item.fluentCrmStatus || null, candidateCount: item.candidateCount, payloadSummary: item.payloadSummary || null, fieldsSent: item.fieldsSent || [], missingFields: item.missingFields || [] })),
    results,
  };
  await markOrganizationSync(summary);
  return summary;
}


async function syncCompanyFromLogtoOrganization({ profile, logtoOrganization, actorUserId = null, auditMetadata = null, markSync = markOrganizationProfileFluentCrmSync, audit = recordAuditLogBestEffort } = {}) {
  const customData = logtoOrganization?.customData || logtoOrganization?.custom_data || {};
  const civitasProfile = customData.civitasProfile || {};
  const business = civitasProfile.business || {};
  const contact = civitasProfile.contact || {};
  const downstreamCrm = civitasProfile.downstream?.crm || {};
  const crmCompany = normalizeCrmCompanyInput({ ...business, companyOwner: contact.owner, companyEmail: contact.email, companyPhone: contact.phone, companyName: downstreamCrm.companyName || logtoOrganization?.name || profile?.nameCache, tags: downstreamCrm.tags, lists: downstreamCrm.lists }, { ...profile, name: logtoOrganization?.name || profile?.nameCache });
  const merged = { ...profile, ...crmCompany, name: logtoOrganization?.name || profile?.nameCache };
  const payload = buildFluentCrmCompanyPayload(merged);
  const missingFields = getMissingCompanyPayloadFields(payload);
  const targetIdentity = { companyName: payload.name || null, fluentcrmCompanyId: profile?.fluentcrmCompanyId || null, logtoOrganizationId: profile?.logtoOrganizationId || null };
  await markSync({ id: profile.id, companyId: profile.fluentcrmCompanyId, status: FLUENTCRM_SYNC_STATUSES.PENDING });
  try {
    const candidates = await findCompanyCandidates({ ...merged, fluentcrmCompanyId: profile.fluentcrmCompanyId });
    const match = findReliableCompanyMatch({ ...merged, fluentcrmCompanyId: profile.fluentcrmCompanyId }, candidates);
    if (match.status === "conflict") {
      const result = { status: "conflict", reason: match.reason, entityType: "company", targetIdentity, fieldsSent: [], fieldDiffs: {}, missingFields, providerStatus: "conflict", providerCode: match.reason, humanMessage: `Company: conflicto ${match.reason}` };
      await markSync({ id: profile.id, companyId: profile.fluentcrmCompanyId, status: FLUENTCRM_SYNC_STATUSES.CONFLICT, errorMessage: `Ambiguous FluentCRM company match: ${match.reason}` });
      await audit({ actorUserId, organizationId: profile.logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_CONFLICT, result: AUDIT_RESULTS.ERROR, metadata: { ...auditMetadata, ...result, candidateCount: match.candidates?.length || 0 } });
      return result;
    }
    if (!match.company) {
      const company = await createCompany(merged);
      const id = companyId(company);
      const result = { status: "created", company, entityType: "company", targetIdentity: { ...targetIdentity, fluentcrmCompanyId: id == null ? null : String(id) }, fieldsSent: Object.keys(payload).filter((key) => payload[key] !== undefined), fieldDiffs: Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined).map(([key, value]) => [key, { before: null, after: comparableValue(value) }])), missingFields, providerStatus: "created", providerCode: null, humanMessage: `Company: creado ${payload.name || "sin nombre"}` };
      await markSync({ id: profile.id, companyId: id == null ? null : String(id), status: FLUENTCRM_SYNC_STATUSES.LINKED, synced: true });
      await audit({ actorUserId, organizationId: profile.logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_SYNC, result: AUDIT_RESULTS.SUCCESS, metadata: { ...auditMetadata, ...result } });
      return result;
    }
    const id = companyId(match.company);
    const { fieldDiffs, patch, fieldsSent } = computeCompanyFieldDiffs(payload, match.company);
    if (fieldsSent.length === 0) {
      const result = { status: "no_changes", company: match.company, entityType: "company", targetIdentity: { ...targetIdentity, fluentcrmCompanyId: id == null ? null : String(id) }, fieldsSent: [], fieldDiffs: {}, missingFields, providerStatus: "no_changes", providerCode: null, humanMessage: "Company: sin cambios para enviar" };
      await markSync({ id: profile.id, companyId: id == null ? null : String(id), status: FLUENTCRM_SYNC_STATUSES.LINKED, synced: true });
      await audit({ actorUserId, organizationId: profile.logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_LINK, result: AUDIT_RESULTS.SUCCESS, metadata: { ...auditMetadata, ...result } });
      return result;
    }
    const company = await updateCompany(id, patch);
    const result = { status: "updated", company, entityType: "company", targetIdentity: { ...targetIdentity, fluentcrmCompanyId: id == null ? null : String(id) }, fieldsSent, fieldDiffs, missingFields, providerStatus: "updated", providerCode: null, humanMessage: `Company: enviado ${fieldsSent.join(", ")}` };
    await markSync({ id: profile.id, companyId: id == null ? null : String(id), status: FLUENTCRM_SYNC_STATUSES.LINKED, synced: true });
    await audit({ actorUserId, organizationId: profile.logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_SYNC, result: AUDIT_RESULTS.SUCCESS, metadata: { ...auditMetadata, ...result } });
    return result;
  } catch (error) {
    const result = { status: "error", entityType: "company", targetIdentity, fieldsSent: [], fieldDiffs: {}, missingFields, providerStatus: "error", providerCode: error.code || null, fluentCrmStatus: error.status || null, humanMessage: error.message };
    error.crmCompanySync = result;
    await markSync({ id: profile.id, companyId: profile.fluentcrmCompanyId, status: FLUENTCRM_SYNC_STATUSES.ERROR, errorMessage: error.message });
    await audit({ actorUserId, organizationId: profile.logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_ERROR, result: AUDIT_RESULTS.ERROR, metadata: { ...auditMetadata, ...result, error } });
    throw error;
  }
}

async function getOrCreateCompanyForOrganization(profile, organization = {}, { actorUserId = null, auditMetadata = null, markSync = markOrganizationProfileFluentCrmSync, audit = recordAuditLogBestEffort } = {}) {
  const crmCompany = normalizeCrmCompanyInput(organization.crm || organization, { ...profile, name: organization.name });
  const merged = { ...profile, ...organization, ...crmCompany, name: organization.name || profile.nameCache };
  await markSync({ id: profile.id, companyId: profile.fluentcrmCompanyId, status: FLUENTCRM_SYNC_STATUSES.PENDING });
  try {
    const candidates = await findCompanyCandidates(merged);
    const match = findReliableCompanyMatch(merged, candidates);
    if (match.status === "conflict") {
      await markSync({ id: profile.id, companyId: profile.fluentcrmCompanyId, status: FLUENTCRM_SYNC_STATUSES.CONFLICT, errorMessage: `Ambiguous FluentCRM company match: ${match.reason}` });
      await audit({ actorUserId, organizationId: profile.logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_CONFLICT, result: AUDIT_RESULTS.ERROR, metadata: { ...auditMetadata, reason: match.reason, candidateCount: match.candidates?.length || 0 } });
      return match;
    }
    const company = match.company || await createCompany(merged);
    const id = companyId(company);
    await markSync({ id: profile.id, companyId: id == null ? null : String(id), status: FLUENTCRM_SYNC_STATUSES.LINKED, synced: true });
    await audit({ actorUserId, organizationId: profile.logtoOrganizationId, action: match.company ? AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_LINK : AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_SYNC, result: AUDIT_RESULTS.SUCCESS, metadata: { ...auditMetadata, reason: match.reason || "created", fluentcrmCompanyId: id == null ? null : String(id) } });
    return { status: match.company ? "linked" : "created", company, reason: match.reason || "created" };
  } catch (error) {
    await markSync({ id: profile.id, companyId: profile.fluentcrmCompanyId, status: FLUENTCRM_SYNC_STATUSES.ERROR, errorMessage: error.message });
    await audit({ actorUserId, organizationId: profile.logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_ERROR, result: AUDIT_RESULTS.ERROR, metadata: { ...auditMetadata, error } });
    throw error;
  }
}

module.exports = { CRM_CLEANUP_STRATEGIES, FluentCrmError, buildCleanupPolicy, buildFluentCrmCompanyPayload, computeCompanyFieldDiffs, buildOrganizationCrmTaxonomy, cleanupContactInFluentCrm, createCompany, createContact, deleteContact, ensureOrganizationTagsAndLists, findCompanyCandidates, findReliableCompanyMatch, getFluentCrmConfig, getFluentCrmDiagnostic, getFluentCrmRoleSyncMapping, getOrCreateCompanyForOrganization, mapOrganizationRolesToCrmTaxonomy, normalizeBaseUrl, normalizeCrmCompanyInput, sanitizeForDiagnostics, searchCompanies, searchContacts, validateFluentCrmConfiguration, syncCompanyFromLogtoOrganization, syncOrganizationContactsToFluentCrm, updateCompany, updateContact, updateContactEmailAfterLogtoChange, upsertContactFromLogtoIdentity };