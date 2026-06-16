const crypto = require("crypto");

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;
const APP_SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;
const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/;

const emptyToNull = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const normalizeSlug = (value) => emptyToNull(value)?.toLowerCase() || null;
const normalizeDomain = (value) => emptyToNull(value)?.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") || null;
const normalizeAppSubdomain = (value) => emptyToNull(value)?.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") || null;
const normalizeHexColor = (value) => emptyToNull(value)?.toLowerCase() || null;

const normalizeOptionalUrl = (value) => {
  const normalized = emptyToNull(value);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch (error) {
    return null;
  }
};

const generateOidcCredentialSegment = (byteLength = 16) => crypto.randomBytes(byteLength).toString("base64url").toLowerCase();
const buildInternalOidcSecretRef = () => `#internal:${crypto.randomBytes(30).toString("base64url")}`;
const buildOidcRedirectUri = (appSubdomain) => `https://${appSubdomain}.learnsocialstudies.com/callback`;

function buildLogtoOrganizationCustomData(settingsValue = {}) {
  return {
    provisioning: {
      slug: settingsValue.slug,
      appSubdomain: settingsValue.subdomain,
      institutionalDomain: settingsValue.adminDomain,
      emailDomainProvisioningStatus: settingsValue.adminDomain ? "pending_logto_configuration" : "not_requested",
      defaultOrganizationRolesStatus: "template_validated",
    },
    oidcRedirectUri: settingsValue.oidcInitialConfig?.oidcRedirectUri || null,
    oidcApplicationId: settingsValue.oidcApplicationId,
    oidcApplicationSecret: settingsValue.oidcApplicationSecretRef,
  };
}

function normalizeExtendedProvisioningInput(body = {}) {
  const slug = normalizeSlug(body.slug);
  const subdomain = normalizeAppSubdomain(body.subdomain ?? body.appSubdomain ?? body.app_subdomain);
  const adminDomain = normalizeDomain(body.adminDomain ?? body.admin_domain ?? body.institutionalProvisioningDomain);
  const primaryColor = normalizeHexColor(body.primaryColor ?? body.branding_primary_color);
  const primaryColorDark = normalizeHexColor(body.primaryColorDark ?? body.branding_primary_color_dark);
  const logoUrl = normalizeOptionalUrl(body.logoUrl ?? body.branding_logo_url);
  const faviconUrl = normalizeOptionalUrl(body.faviconUrl ?? body.branding_favicon_url);
  const oidcApplicationId = `oidc_${generateOidcCredentialSegment(16)}`;
  const oidcApplicationSecretRef = buildInternalOidcSecretRef();
  const oidcRedirectUri = subdomain ? buildOidcRedirectUri(subdomain) : null;

  const errors = [];
  if (!slug) errors.push({ field: "slug", message: "Slug is required" });
  if (slug && !SLUG_PATTERN.test(slug)) errors.push({ field: "slug", message: "Slug must use lowercase letters, numbers and hyphens, without leading or trailing hyphens" });
  if (!subdomain) errors.push({ field: "subdomain", message: "Application subdomain is required" });
  if (subdomain && !APP_SUBDOMAIN_PATTERN.test(subdomain)) errors.push({ field: "subdomain", message: "Application subdomain must be a single DNS label using lowercase letters, numbers and hyphens" });
  if (!adminDomain) errors.push({ field: "adminDomain", message: "Institutional provisioning domain is required" });
  if (adminDomain && !DOMAIN_PATTERN.test(adminDomain)) errors.push({ field: "adminDomain", message: "Institutional provisioning domain must be a valid hostname such as colegio.edu.co" });
  if ((body.logoUrl ?? body.branding_logo_url) && !logoUrl) errors.push({ field: "logoUrl", message: "Logo URL must be an http(s) URL" });
  if ((body.faviconUrl ?? body.branding_favicon_url) && !faviconUrl) errors.push({ field: "faviconUrl", message: "Favicon URL must be an http(s) URL" });
  if (primaryColor && !HEX_COLOR_PATTERN.test(primaryColor)) errors.push({ field: "primaryColor", message: "Primary color must be a hex color" });
  if (primaryColorDark && !HEX_COLOR_PATTERN.test(primaryColorDark)) errors.push({ field: "primaryColorDark", message: "Dark primary color must be a hex color" });

  return {
    errors,
    value: {
      type: emptyToNull(body.type),
      subdomain,
      slug,
      adminDomain,
      logoUrl,
      faviconUrl,
      primaryColor,
      primaryColorDark,
      organizationLoginExperienceEnabled: Boolean(body.organizationLoginExperienceEnabled),
      oidcApplicationId,
      oidcApplicationSecretRef,
      oidcInitialConfig: { oidcRedirectUri, oidcApplicationId, oidcApplicationSecretRef, status: "sent_to_logto_custom_data" },
      emailDomainProvisioningStatus: adminDomain ? "pending_logto_configuration" : "not_requested",
      settings: { scaffoldVersion: 1, status: "prepared" },
      seatTotal: body.seatTotal,
    },
  };
}

function buildExtendedProfileFields(settingsValue, { baseAdmin } = {}) {
  return {
    type: settingsValue.type,
    subdomain: settingsValue.subdomain,
    slug: settingsValue.slug,
    adminDomain: settingsValue.adminDomain,
    logoUrl: settingsValue.logoUrl,
    faviconUrl: settingsValue.faviconUrl,
    primaryColor: settingsValue.primaryColor,
    primaryColorDark: settingsValue.primaryColorDark,
    organizationLoginExperienceEnabled: false,
    oidcApplicationId: settingsValue.oidcApplicationId,
    oidcInitialConfig: settingsValue.oidcInitialConfig,
    oidcApplicationSecretRef: settingsValue.oidcApplicationSecretRef,
    emailDomainProvisioningStatus: settingsValue.emailDomainProvisioningStatus,
    settings: { ...(settingsValue.settings || {}), baseAdmin, supportDetailsVisible: true },
    seatTotal: settingsValue.seatTotal,
  };
}

module.exports = { buildExtendedProfileFields, buildLogtoOrganizationCustomData, normalizeExtendedProvisioningInput };
