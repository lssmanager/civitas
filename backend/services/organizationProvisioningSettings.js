const { buildLogtoOrganizationCustomData: buildSeparatedLogtoOrganizationCustomData } = require("./organizationProvisioningPayloads");

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;
const APP_BASE_DOMAINS = Object.freeze(["didaxus.com", "socialstudies.cloud", "learnsocialstudies.com"]);
const APP_SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;
const emptyToNull = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const normalizeSlug = (value) => emptyToNull(value)?.toLowerCase() || null;
const removeProtocolPrefix = (value) => {
  if (value.startsWith("https://")) return value.slice("https://".length);
  if (value.startsWith("http://")) return value.slice("http://".length);
  return value;
};
const stripPathSuffix = (value) => {
  const slashIndex = value.indexOf("/");
  return slashIndex === -1 ? value : value.slice(0, slashIndex);
};
const normalizeDomain = (value) => {
  const normalized = emptyToNull(value)?.toLowerCase();
  if (!normalized) return null;
  return stripPathSuffix(removeProtocolPrefix(normalized));
};
const normalizeAppSubdomain = (value) => emptyToNull(value)?.toLowerCase() || null;
const normalizeAppBaseDomain = (value) => emptyToNull(value)?.toLowerCase() || null;
const buildEntryUrl = (appSubdomain, appBaseDomain) => `https://${appSubdomain}.${appBaseDomain}`;
const buildOidcRedirectUri = (appSubdomain, appBaseDomain) => `${buildEntryUrl(appSubdomain, appBaseDomain)}/callback`;

function buildLogtoOrganizationCustomData(settingsValue = {}, canonical = {}, crm = {}) {
  return buildSeparatedLogtoOrganizationCustomData({ canonical, extended: settingsValue, crm });
}

function normalizeExtendedProvisioningInput(body = {}) {
  const slug = normalizeSlug(body.slug);
  const subdomain = normalizeAppSubdomain(body.subdomain ?? body.appSubdomain ?? body.app_subdomain);
  const appBaseDomain = normalizeAppBaseDomain(body.appBaseDomain ?? body.app_base_domain);
  const adminDomain = normalizeDomain(body.adminDomain ?? body.admin_domain ?? body.institutionalProvisioningDomain);
  const oidcRedirectUri = subdomain && appBaseDomain ? buildOidcRedirectUri(subdomain, appBaseDomain) : null;
  const errors = [];
  if (slug && !SLUG_PATTERN.test(slug)) errors.push({ field: "slug", message: "Slug must use lowercase letters, numbers and hyphens, without leading or trailing hyphens" });
  if (!subdomain) errors.push({ field: "subdomain", message: "Application subdomain is required" });
  if (subdomain && (!APP_SUBDOMAIN_PATTERN.test(subdomain) || subdomain.includes(":") || subdomain.includes("/") || subdomain.includes("."))) errors.push({ field: "subdomain", message: "Application subdomain must be a single DNS label using lowercase letters, numbers and hyphens" });
  if (!appBaseDomain) errors.push({ field: "appBaseDomain", message: "Application base domain is required" });
  if (appBaseDomain && !APP_BASE_DOMAINS.includes(appBaseDomain)) errors.push({ field: "appBaseDomain", message: `Application base domain must be one of: ${APP_BASE_DOMAINS.join(", ")}` });
  if (!adminDomain) errors.push({ field: "adminDomain", message: "Institutional provisioning domain is required" });
  if (adminDomain && !DOMAIN_PATTERN.test(adminDomain)) errors.push({ field: "adminDomain", message: "Institutional provisioning domain must be a valid hostname such as colegio.edu.co" });
  return { errors, value: { subdomain, appSubdomain: subdomain, appBaseDomain, entryUrl: subdomain && appBaseDomain ? buildEntryUrl(subdomain, appBaseDomain) : null, slug, adminDomain, oidcRedirectUri, type: emptyToNull(body.organizationType ?? body.organization_type ?? body.crm?.type) || null, seatTotal: Number.isInteger(Number(body.seatTotal)) && Number(body.seatTotal) >= 0 ? Number(body.seatTotal) : 0 } };
}
module.exports = { APP_BASE_DOMAINS, buildEntryUrl, buildOidcRedirectUri, buildLogtoOrganizationCustomData, normalizeExtendedProvisioningInput };
