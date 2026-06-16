const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;
const APP_SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;

const emptyToNull = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const normalizeSlug = (value) => emptyToNull(value)?.toLowerCase() || null;
const normalizeDomain = (value) => emptyToNull(value)?.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") || null;
const normalizeAppSubdomain = (value) => emptyToNull(value)?.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") || null;
const buildOidcRedirectUri = (appSubdomain) => `https://${appSubdomain}.learnsocialstudies.com/callback`;

function buildLogtoOrganizationCustomData(settingsValue = {}) {
  return {
    provisioning: {
      slug: settingsValue.slug,
      appSubdomain: settingsValue.subdomain,
      institutionalDomain: settingsValue.adminDomain,
      jitDefaultRoleNames: settingsValue.jitDefaultRoleNames || [],
    },
    oidcRedirectUri: settingsValue.oidcRedirectUri || null,
  };
}

function normalizeExtendedProvisioningInput(body = {}) {
  const slug = normalizeSlug(body.slug);
  const subdomain = normalizeAppSubdomain(body.subdomain ?? body.appSubdomain ?? body.app_subdomain);
  const jitProvisioning = body.jitProvisioning && typeof body.jitProvisioning === "object" ? body.jitProvisioning : {};
  const adminDomain = normalizeDomain(jitProvisioning.domain ?? body.adminDomain ?? body.admin_domain ?? body.institutionalProvisioningDomain);
  const jitDefaultRoleNames = Array.isArray(jitProvisioning.defaultRoleNames) ? jitProvisioning.defaultRoleNames.filter((roleName) => typeof roleName === "string" && roleName.trim()).map((roleName) => roleName.trim()) : [];
  const oidcRedirectUri = subdomain ? buildOidcRedirectUri(subdomain) : null;

  const errors = [];
  if (!slug) errors.push({ field: "slug", message: "Slug is required" });
  if (slug && !SLUG_PATTERN.test(slug)) errors.push({ field: "slug", message: "Slug must use lowercase letters, numbers and hyphens, without leading or trailing hyphens" });
  if (!subdomain) errors.push({ field: "subdomain", message: "Application subdomain is required" });
  if (subdomain && !APP_SUBDOMAIN_PATTERN.test(subdomain)) errors.push({ field: "subdomain", message: "Application subdomain must be a single DNS label using lowercase letters, numbers and hyphens" });
  if (!adminDomain) errors.push({ field: "adminDomain", message: "Institutional provisioning domain is required" });
  if (adminDomain && !DOMAIN_PATTERN.test(adminDomain)) errors.push({ field: "adminDomain", message: "Institutional provisioning domain must be a valid hostname such as colegio.edu.co" });
  return {
    errors,
    value: {
      subdomain,
      slug,
      adminDomain,
      jitDefaultRoleNames,
      oidcRedirectUri,
    },
  };
}

module.exports = { buildLogtoOrganizationCustomData, normalizeExtendedProvisioningInput };
