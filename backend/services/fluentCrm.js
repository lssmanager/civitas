const { AUDIT_ACTIONS, AUDIT_RESULTS, recordAuditLogBestEffort } = require("./auditLogs");
const { FLUENTCRM_SYNC_STATUSES, markOrganizationProfileFluentCrmSync } = require("./organizationProfiles");

class FluentCrmError extends Error {
  constructor(message, { status, body, code, diagnostic, request } = {}) {
    super(message);
    this.name = "FluentCrmError";
    this.status = status;
    this.body = sanitizeForDiagnostics(body);
    this.code = code;
    this.diagnostic = diagnostic || null;
    this.request = request ? sanitizeForDiagnostics(request) : null;
  }
}

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
const DEFAULT_ROLE_SYNC_MAPPING = Object.freeze({
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
const normalizeStringList = (value) => Array.isArray(value) ? [...new Set(value.map(normalizeString).filter(Boolean))] : [];
const normalizeInteger = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

function normalizeCrmCompanyInput(input = {}, fallback = {}) {
  const companyName = normalizeString(input.companyName ?? input.name) || normalizeString(fallback.name ?? fallback.nameCache);
  return {
    companyName,
    companyEmail: normalizeEmail(input.companyEmail ?? input.email),
    companyPhone: normalizeString(input.companyPhone ?? input.phone),
    website: normalizeString(input.website ?? fallback.website ?? fallback.adminDomain),
    numberOfEmployees: normalizeInteger(input.numberOfEmployees),
    industry: normalizeString(input.industry),
    type: normalizeString(input.type),
    companyOwner: normalizeString(input.companyOwner),
    about: normalizeString(input.about ?? input.description ?? input.companyDescription),
    description: normalizeString(input.description ?? input.about ?? input.companyDescription),
    nit: normalizeInteger(input.nit),
    verificationDigit: normalizeInteger(input.verificationDigit ?? input.digito_de_verificación ?? input.digito_de_verificacion),
    rector: normalizeString(input.rector),
    emailRector: normalizeEmail(input.emailRector ?? input.email_rector),
    coordinatorName1: normalizeString(input.coordinatorName1 ?? input.cordinador_name_1),
    coordinatorEmail1: normalizeEmail(input.coordinatorEmail1 ?? input.cordinador_email_1),
    coordinatorName2: normalizeString(input.coordinatorName2 ?? input.cordinador_name_2),
    coordinatorEmail2: normalizeEmail(input.coordinatorEmail2 ?? input.cordinador_email_2),
    coordinatorName3: normalizeString(input.coordinatorName3 ?? input.cordinador_name_3),
    coordinatorEmail3: normalizeEmail(input.coordinatorEmail3 ?? input.cordinador_email_3),
    tags: normalizeStringList(input.tags),
    lists: normalizeStringList(input.lists),
  };
}

function buildFluentCrmCompanyPayload(company = {}) {
  const customValues = {};
  if (company.nit != null) customValues.nit = company.nit;
  if (company.verificationDigit != null) customValues["digito_de_verificación"] = company.verificationDigit;
  if (company.rector) customValues.rector = company.rector;
  if (company.emailRector) customValues.email_rector = company.emailRector;
  if (company.coordinatorName1) customValues.cordinador_name_1 = company.coordinatorName1;
  if (company.coordinatorEmail1) customValues.cordinador_email_1 = company.coordinatorEmail1;
  if (company.coordinatorName2) customValues.cordinador_name_2 = company.coordinatorName2;
  if (company.coordinatorEmail2) customValues.cordinador_email_2 = company.coordinatorEmail2;
  if (company.coordinatorName3) customValues.cordinador_name_3 = company.coordinatorName3;
  if (company.coordinatorEmail3) customValues.cordinador_email_3 = company.coordinatorEmail3;

  return {
    name: company.companyName || company.name || company.nameCache,
    email: company.companyEmail || company.email || company.billingEmail || company.contactEmail || undefined,
    phone: company.companyPhone || company.phone || undefined,
    website: company.website || company.adminDomain || undefined,
    number_of_employees: company.numberOfEmployees ?? undefined,
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

function getFluentCrmDiagnostic(response, parsed, path) {
  if (response.status === 401) return { code: "FLUENTCRM_AUTHENTICATION_FAILED", message: "FluentCRM authentication failed (401). Verify FLUENTCRM_USERNAME and FLUENTCRM_APP_PASSWORD are a valid WordPress Application Password for the configured site.", likelyCauses: ["invalid_username", "invalid_application_password", "basic_auth_blocked", "wrong_base_url_or_site"] };
  if (response.status === 403) return { code: "FLUENTCRM_AUTHORIZATION_FAILED", message: "FluentCRM authorization failed (403). The WordPress user authenticated, but does not have permission to access FluentCRM REST endpoints.", likelyCauses: ["wordpress_user_lacks_fluentcrm_permissions", "security_plugin_blocks_rest_api"] };
  if (response.status === 404) return { code: "FLUENTCRM_ENDPOINT_NOT_FOUND", message: `FluentCRM endpoint was not found at /wp-json/fluent-crm/v2${path}. Verify FLUENTCRM_BASE_URL and that FluentCRM is installed and REST API endpoints are enabled.`, likelyCauses: ["wrong_base_url", "fluentcrm_plugin_missing_or_inactive", "rest_route_unavailable"] };
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
  return {
    tag: { title: `Civitas Organization: ${name || safeSlug}`, slug: `civitas-org-${safeSlug}` },
    list: { title: `Civitas ${name || safeSlug}`, slug: `civitas-${safeSlug}` },
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
  const nextTags = currentTagNames.filter((name) => name !== taxonomy.tag.title && name !== taxonomy.tag.slug);
  const nextLists = currentListNames.filter((name) => name !== taxonomy.list.title && name !== taxonomy.list.slug);
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
  if (!process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON) return DEFAULT_ROLE_SYNC_MAPPING;
  try {
    return { ...DEFAULT_ROLE_SYNC_MAPPING, ...JSON.parse(process.env.FLUENTCRM_ROLE_SYNC_MAPPING_JSON) };
  } catch (error) {
    throw new FluentCrmError("FLUENTCRM_ROLE_SYNC_MAPPING_JSON must be valid JSON", { code: "FLUENTCRM_ROLE_MAPPING_INVALID" });
  }
}

function mapOrganizationRolesToCrmTaxonomy(roleNames = [], mapping = getFluentCrmRoleSyncMapping()) {
  const tags = new Set();
  const lists = new Set();
  const excludedRoles = [];
  const unmappedRoles = [];
  const mappedRoles = [];
  for (const roleName of roleNames) {
    if (PROHIBITED_ROLE_NAMES.has(roleName)) {
      excludedRoles.push(roleName);
      continue;
    }
    const mapped = mapping[roleName];
    if (!mapped) {
      unmappedRoles.push(roleName);
      continue;
    }
    mappedRoles.push({ roleName, roleType: mapped.roleType || "organizational" });
    (mapped.tags || []).forEach((tag) => tags.add(tag));
    (mapped.lists || []).forEach((list) => lists.add(list));
  }
  return { tags: [...tags], lists: [...lists], mappedRoles, unmappedRoles, excludedRoles, note: "CRM tags/lists are communication segmentation only; Logto roles remain the permission source." };
}

async function createContact(fields = {}) {
  return requestFluentCrm("/subscribers", { method: "POST", body: fields });
}

async function upsertContactFromLogtoIdentity({ identity, companyId, roleNames = [] }) {
  const email = normalizeEmail(identity.email);
  if (!email) return { status: "error", reason: "missing_email", logtoUserId: identity.logtoUserId || null };
  const contacts = await searchContacts({ email });
  if (contacts.length > 1) return { status: "conflict", reason: "duplicate_contact", email, logtoUserId: identity.logtoUserId || null, candidateCount: contacts.length };
  const taxonomy = mapOrganizationRolesToCrmTaxonomy(roleNames);
  const payload = {
    email,
    full_name: normalizeString(identity.name),
    phone: normalizeString(identity.phone),
    external_id: identity.logtoUserId || undefined,
    company_id: companyId,
    tags: taxonomy.tags,
    lists: taxonomy.lists,
  };
  const contact = contacts[0] ? await updateContact(contacts[0], payload) : await createContact(payload);
  return { status: contacts[0] ? "updated" : "created", contact, email, logtoUserId: identity.logtoUserId || null, taxonomy };
}

async function syncOrganizationContactsToFluentCrm({ profile, members, getMemberRoles, audit = async () => {}, markOrganizationSync = async () => {} }) {
  if (!profile?.fluentcrmCompanyId) {
    const summary = { status: "error", reason: "company_not_linked", total: members.length, succeeded: 0, failed: members.length, conflicts: 0, errors: [{ reason: "company_not_linked" }] };
    await markOrganizationSync(summary);
    await audit({ result: "error", summary });
    return summary;
  }
  const results = [];
  for (const member of members) {
    const identity = {
      logtoUserId: member.id || member.userId || member.logtoUserId || member.sub || null,
      email: member.primaryEmail || member.email || member.profile?.email || null,
      name: member.name || member.profile?.name || null,
      phone: member.primaryPhone || member.phone || member.profile?.phone || null,
    };
    try {
      const roleNames = await getMemberRoles(identity.logtoUserId);
      const result = await upsertContactFromLogtoIdentity({ identity, companyId: profile.fluentcrmCompanyId, roleNames });
      results.push(result);
      await audit({ result: result.status === "conflict" || result.status === "error" ? "error" : "success", member: { logtoUserId: identity.logtoUserId, email: identity.email }, syncResult: result });
    } catch (error) {
      const result = { status: "error", reason: "crm_request_failed", logtoUserId: identity.logtoUserId, email: identity.email, message: error.message };
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
    errors: results.filter((item) => item.status === "error" || item.status === "conflict").map((item) => ({ logtoUserId: item.logtoUserId, email: item.email, reason: item.reason, message: item.message, candidateCount: item.candidateCount })),
    results,
  };
  await markOrganizationSync(summary);
  return summary;
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

module.exports = { CRM_CLEANUP_STRATEGIES, FluentCrmError, buildCleanupPolicy, buildFluentCrmCompanyPayload, buildOrganizationCrmTaxonomy, cleanupContactInFluentCrm, createCompany, createContact, deleteContact, ensureOrganizationTagsAndLists, findCompanyCandidates, findReliableCompanyMatch, getFluentCrmConfig, getFluentCrmRoleSyncMapping, getOrCreateCompanyForOrganization, mapOrganizationRolesToCrmTaxonomy, normalizeBaseUrl, normalizeCrmCompanyInput, sanitizeForDiagnostics, searchCompanies, searchContacts, validateFluentCrmConfiguration, syncOrganizationContactsToFluentCrm, updateContact, updateContactEmailAfterLogtoChange, upsertContactFromLogtoIdentity };