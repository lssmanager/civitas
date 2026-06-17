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
  const email = normalizeEmail(organization.email || organization.billingEmail || organization.contactEmail);
  if (email) (await searchCompanies({ email })).forEach((c) => add(c, "email"));
  const name = normalizeName(organization.name || organization.nameCache);
  if (name) (await searchCompanies({ search: organization.name || organization.nameCache })).forEach((c) => add(c, "name"));
  return [...seen.values()].map(({ company, sources }) => ({ company, sources }));
}

function findReliableCompanyMatch(organization = {}, candidates = []) {
  if (organization.fluentcrmCompanyId) {
    const matches = candidates.filter(({ company }) => String(companyId(company)) === String(organization.fluentcrmCompanyId));
    if (matches.length === 1) return { status: "matched", company: matches[0].company, reason: "fluentcrm_company_id" };
  }
  const domain = normalizeDomain(organization.website || organization.adminDomain || organization.domain);
  const email = normalizeEmail(organization.email || organization.billingEmail || organization.contactEmail);
  const name = normalizeName(organization.name || organization.nameCache);
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
  const payload = { name: organization.name || organization.nameCache, website: organization.website || organization.adminDomain || undefined, email: organization.email || organization.billingEmail || organization.contactEmail || undefined };
  const body = await requestFluentCrm("/companies", { method: "POST", body: payload });
  return extractCompanies(body)[0] || body;
}

async function getOrCreateCompanyForOrganization(profile, organization = {}, { actorUserId = null, auditMetadata = null, markSync = markOrganizationProfileFluentCrmSync, audit = recordAuditLogBestEffort } = {}) {
  const merged = { ...organization, ...profile, name: organization.name || profile.nameCache };
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

module.exports = { FluentCrmError, createCompany, findCompanyCandidates, findReliableCompanyMatch, getFluentCrmConfig, getOrCreateCompanyForOrganization, normalizeBaseUrl, sanitizeForDiagnostics, searchCompanies };
