const { AUDIT_ACTIONS, AUDIT_RESULTS, recordAuditLogBestEffort } = require("./auditLogs");
const { FLUENTCRM_SYNC_STATUSES, markOrganizationProfileFluentCrmSync } = require("./organizationProfiles");

class FluentCrmError extends Error {
  constructor(message, { status, body, code } = {}) {
    super(message);
    this.name = "FluentCrmError";
    this.status = status;
    this.body = sanitizeForDiagnostics(body);
    this.code = code;
  }
}

const SENSITIVE_KEY_PATTERN = /(authorization|password|app[_-]?password|secret|token|credential|cookie|api[_-]?key)/i;

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
  return { baseUrl, username, appPassword };
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
  };
}

function buildFluentCrmCompanyPayload(company = {}) {
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

async function requestFluentCrm(path, { method = "GET", query, body } = {}) {
  const config = getFluentCrmConfig();
  const url = new URL(`${config.baseUrl}/wp-json/fluent-crm/v2${path}`);
  if (query) Object.entries(query).forEach(([key, value]) => value != null && url.searchParams.set(key, value));
  const response = await fetch(url, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: buildAuthHeader(config) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new FluentCrmError("FluentCRM returned invalid JSON", { status: response.status, body: { responseBody: text }, code: "FLUENTCRM_INVALID_JSON" });
    }
  }
  if (!response.ok) throw new FluentCrmError("FluentCRM request failed", { status: response.status, body: parsed, code: "FLUENTCRM_REQUEST_FAILED" });
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
  const payload = { name: organization.companyName || organization.name || organization.nameCache, website: organization.website || organization.adminDomain || undefined, email: organization.companyEmail || organization.email || organization.billingEmail || organization.contactEmail || undefined };
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

async function searchContacts({ email, externalId } = {}) {
  const query = externalId || normalizeEmail(email);
  if (!query) return [];
  const body = await requestFluentCrm("/subscribers", { query: { search: query, per_page: 20 } });
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.subscribers)) return body.subscribers;
  if (Array.isArray(body?.contacts)) return body.contacts;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

const contactId = (contact = {}) => contact.id ?? contact.ID ?? contact.subscriber_id ?? null;

async function updateContact(contactIdentifier, fields = {}) {
  const id = typeof contactIdentifier === "object" ? contactId(contactIdentifier) : contactIdentifier;
  if (!id) throw new FluentCrmError("Cannot update FluentCRM contact without an id", { code: "FLUENTCRM_CONTACT_ID_MISSING" });
  return requestFluentCrm(`/subscribers/${encodeURIComponent(id)}`, { method: "PUT", body: fields });
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

module.exports = { FluentCrmError, buildOrganizationCrmTaxonomy, createCompany, ensureOrganizationTagsAndLists, findCompanyCandidates, findReliableCompanyMatch, getFluentCrmConfig, getOrCreateCompanyForOrganization, normalizeBaseUrl, normalizeCrmCompanyInput, sanitizeForDiagnostics, searchCompanies, searchContacts, updateContact, updateContactEmailAfterLogtoChange };
