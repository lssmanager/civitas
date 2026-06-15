const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { requireAuth, requireOrganizationAccess, requireScope } = require("./middleware/auth");
const { requireOwner } = require("./middleware/owner");
const { checkDatabaseConnection } = require("./db/connection");
const { getIdentityFromLogtoClaims, getOrCreateInternalUser, serializeUser } = require("./services/users");
const {
  ORGANIZATION_ADMIN_ROLE_NAME,
  addUserToLogtoOrganization,
  assignOrganizationRoleToUser,
  createLogtoOrganization,
  ensureOrganizationTemplate,
  findLogtoOrganizationByName,
  findOrganizationRoleByName,
  getLogtoUserById,
  listLogtoOrganizationRoles,
  listLogtoOrganizations,
} = require("./services/logtoManagement");
const {
  LOGTO_SYNC_STATUSES,
  findOrganizationProfileBySlugOrAdminDomain,
  listOrganizationProfiles,
  markOrganizationProfileLogtoSyncError,
  markOrganizationProfileProvisioningStage,
  serializeOrganizationProfile,
  upsertOrganizationProfile,
} = require("./services/organizationProfiles");
const {
  AUDIT_ACTIONS,
  AUDIT_RESULTS,
  listAuditLogs,
  recordAuditLogBestEffort,
} = require("./services/auditLogs");

const app = express();
const port = process.env.PORT || 3000;
const API_RESOURCE = process.env.LOGTO_API_RESOURCE_INDICATOR;

app.use(cors());
app.use(express.json());

const getLogtoOrganizationId = (organization) => organization.id || organization.organizationId || organization.logtoOrganizationId;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;
const APP_SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;
const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/;
const DEFAULT_ROLE_NAMES = [ORGANIZATION_ADMIN_ROLE_NAME];

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

const normalizeRoleNames = (value) => {
  const input = Array.isArray(value) ? value : DEFAULT_ROLE_NAMES;
  const roles = input.map((role) => typeof role === "string" ? role.trim() : "").filter(Boolean);
  return Array.from(new Set(roles.length > 0 ? roles : DEFAULT_ROLE_NAMES));
};

function validateOrganizationProvisioningInput(body = {}) {
  const normalizedName = typeof body.name === "string" ? body.name.trim() : "";
  const slug = normalizeSlug(body.slug);
  const subdomain = normalizeAppSubdomain(body.subdomain ?? body.appSubdomain ?? body.app_subdomain);
  const adminDomain = normalizeDomain(body.adminDomain ?? body.admin_domain ?? body.institutionalProvisioningDomain);
  const primaryColor = normalizeHexColor(body.primaryColor ?? body.branding_primary_color);
  const primaryColorDark = normalizeHexColor(body.primaryColorDark ?? body.branding_primary_color_dark);
  const logoUrl = normalizeOptionalUrl(body.logoUrl ?? body.branding_logo_url);
  const faviconUrl = normalizeOptionalUrl(body.faviconUrl ?? body.branding_favicon_url);
  const oidcRedirectUri = subdomain ? buildOidcRedirectUri(subdomain) : null;
  const oidcApplicationId = `oidc_${generateOidcCredentialSegment(16)}`;
  const oidcApplicationSecret = buildInternalOidcSecretRef();
  const baseAdmin = body.baseAdmin && typeof body.baseAdmin === "object" ? body.baseAdmin : {};
  const baseAdminName = emptyToNull(baseAdmin.name ?? body.baseAdminName);
  const baseAdminEmail = emptyToNull(baseAdmin.email ?? body.baseAdminEmail)?.toLowerCase() || null;
  const baseAdminLogtoUserId = emptyToNull(baseAdmin.logtoUserId ?? body.baseAdminLogtoUserId);

  const errors = [];
  if (!normalizedName) errors.push({ field: "name", message: "Organization name is required" });
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
  if (!baseAdminName) errors.push({ field: "baseAdmin.name", message: "Base admin name is required" });
  if (!baseAdminEmail) errors.push({ field: "baseAdmin.email", message: "Base admin email is required" });
  if (baseAdminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(baseAdminEmail)) errors.push({ field: "baseAdmin.email", message: "Base admin email must be a valid email address" });

  return {
    errors,
    value: {
      name: normalizedName,
      description: typeof body.description === "string" ? body.description.trim() : undefined,
      type: emptyToNull(body.type),
      subdomain,
      slug,
      adminDomain,
      logoUrl,
      faviconUrl,
      primaryColor,
      primaryColorDark,
      organizationLoginExperienceEnabled: Boolean(body.organizationLoginExperienceEnabled),
      defaultRoleNames: normalizeRoleNames(body.defaultRoleNames),
      baseAdmin: { name: baseAdminName, email: baseAdminEmail, logtoUserId: baseAdminLogtoUserId },
      oidcApplicationId,
      oidcApplicationSecret,
      oidcInitialConfig: {
        oidcRedirectUri,
        oidcApplicationId,
        oidcApplicationSecret,
        status: "prepared_local_only",
      },
      emailDomainProvisioningStatus: adminDomain ? "prepared" : "not_requested",
      settings: { scaffoldVersion: 1, status: "prepared" },
      seatTotal: body.seatTotal,
    },
  };
}

const getLogtoOrganizationName = (organization) => organization.name || organization.nameCache || null;

const serializeOwnerOrganization = (profile, logtoOrganization = null) => ({
  logtoOrganizationId: profile?.logtoOrganizationId || (logtoOrganization ? getLogtoOrganizationId(logtoOrganization) : null),
  name: (logtoOrganization ? getLogtoOrganizationName(logtoOrganization) : null) || profile?.nameCache || null,
  logtoOrganization: logtoOrganization || null,
  profile: profile ? serializeOrganizationProfile(profile) : null,
});

const toMillis = (value) => {
  const time = value instanceof Date ? value.getTime() : new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
};

const sortProfilesByNewest = (profiles) =>
  [...profiles].sort((left, right) => toMillis(right.updatedAt) - toMillis(left.updatedAt) || toMillis(right.createdAt) - toMillis(left.createdAt));

const getCanonicalLogtoOrganizationName = (organization) => getLogtoOrganizationName(organization);


const normalizeLogtoUserToClaims = (logtoUser = {}) => ({
  sub: logtoUser.id || logtoUser.userId || logtoUser.sub,
  email: logtoUser.primaryEmail || logtoUser.email || logtoUser.profile?.email,
  name: logtoUser.name || logtoUser.profile?.name,
  username: logtoUser.username || logtoUser.profile?.username,
  picture: logtoUser.avatar || logtoUser.profile?.picture,
});

async function getLogtoIdentityClaimsBestEffort(logtoUserId) {
  if (!logtoUserId) return {};

  try {
    return normalizeLogtoUserToClaims(await getLogtoUserById(logtoUserId));
  } catch (error) {
    console.error("Failed to enrich identity from Logto Management API", error);
    return {};
  }
}

const buildSessionTokenMetadata = (claims = {}) => ({
  issuedAt: claims.iat ? new Date(Number(claims.iat) * 1000).toISOString() : null,
  expiresAt: claims.exp ? new Date(Number(claims.exp) * 1000).toISOString() : null,
  permissionFreshness: "Token claims are authoritative for this request; Logto role changes apply after token renewal or expiration.",
});

const buildRequestIdentity = (authUser, internalUser = null) => {
  const logtoIdentity = getIdentityFromLogtoClaims({ ...(authUser?.claims || {}), sub: authUser?.sub });
  return {
    internalUserId: internalUser?.id ?? null,
    logtoUserId: logtoIdentity.logtoUserId,
    email: logtoIdentity.email ?? internalUser?.email ?? null,
    displayName: logtoIdentity.displayName,
    username: logtoIdentity.username,
  };
};

const buildAuditContext = ({ authUser, internalUser, organization = null } = {}) => ({
  actor: buildRequestIdentity(authUser, internalUser),
  ...(organization
    ? {
        organization: {
          id: getLogtoOrganizationId(organization),
          name: getLogtoOrganizationName(organization),
        },
      }
    : {}),
});

const buildOrganizationNamesById = (logtoOrganizations = []) =>
  new Map(
    logtoOrganizations
      .map((organization) => [getLogtoOrganizationId(organization), getLogtoOrganizationName(organization)])
      .filter(([id]) => Boolean(id))
  );

function buildLogtoOrganizationDirectory({ logtoOrganizations, profiles }) {
  const profilesByLogtoId = new Map();
  const orphanProfiles = [];

  for (const profile of profiles) {
    if (profile.logtoOrganizationId) {
      const existingProfiles = profilesByLogtoId.get(profile.logtoOrganizationId) || [];
      existingProfiles.push(profile);
      profilesByLogtoId.set(profile.logtoOrganizationId, existingProfiles);
    } else {
      orphanProfiles.push(profile);
    }
  }

  const matchedOrphanProfileIds = new Set();
  const organizations = logtoOrganizations
    .map((logtoOrganization) => {
      const logtoOrganizationId = getLogtoOrganizationId(logtoOrganization);
      if (!logtoOrganizationId) return null;

      const canonicalName = getCanonicalLogtoOrganizationName(logtoOrganization);
      const linkedProfiles = profilesByLogtoId.get(logtoOrganizationId) || [];
      const nameMatchedOrphans = orphanProfiles.filter((profile) => profile.nameCache && canonicalName && profile.nameCache === canonicalName);

      for (const profile of nameMatchedOrphans) {
        matchedOrphanProfileIds.add(profile.id);
      }

      const associatedProfiles = sortProfilesByNewest([...linkedProfiles, ...nameMatchedOrphans]);
      const profile = associatedProfiles[0] || null;
      const hasConflict = associatedProfiles.length > 1;
      const reconciliationStatus = hasConflict
        ? "conflict"
        : profile
          ? profile.logtoOrganizationId === logtoOrganizationId
            ? "linked"
            : "name_matched_pending_link"
          : "metadata_missing";

      return {
        logtoOrganizationId,
        name: canonicalName,
        logtoOrganization,
        profile: profile ? serializeOrganizationProfile(profile) : null,
        syncStatus: hasConflict ? "conflict" : profile?.logtoSyncStatus || "metadata_missing",
        syncError: hasConflict
          ? "Multiple internal profiles match this Logto organization and require reconciliation."
          : profile?.logtoSyncError || null,
        reconciliation: {
          status: reconciliationStatus,
          profileCount: associatedProfiles.length,
          matchedBy: linkedProfiles.length > 0 ? "logto_organization_id" : nameMatchedOrphans.length > 0 ? "name" : null,
          profileIds: associatedProfiles.map((associatedProfile) => associatedProfile.id),
        },
      };
    })
    .filter(Boolean);

  const unreconciledProfiles = orphanProfiles
    .filter((profile) => !matchedOrphanProfileIds.has(profile.id))
    .map(serializeOrganizationProfile);

  return { organizations, unreconciledProfiles };
}


async function reconcileProfilesWithLogtoOrganizations({ logtoOrganizations, profiles, auditActorUserId = null }) {
  const profilesByLogtoId = new Map();
  const orphanProfiles = [];

  for (const profile of profiles) {
    if (profile.logtoOrganizationId) {
      const group = profilesByLogtoId.get(profile.logtoOrganizationId) || [];
      group.push(profile);
      profilesByLogtoId.set(profile.logtoOrganizationId, group);
    } else {
      orphanProfiles.push(profile);
    }
  }

  let changed = false;
  for (const logtoOrganization of logtoOrganizations) {
    const logtoOrganizationId = getLogtoOrganizationId(logtoOrganization);
    const canonicalName = getCanonicalLogtoOrganizationName(logtoOrganization);
    if (!logtoOrganizationId || profilesByLogtoId.has(logtoOrganizationId) || !canonicalName) continue;

    const nameMatches = orphanProfiles.filter((profile) => profile.nameCache === canonicalName);
    if (nameMatches.length !== 1) continue;

    const [profile] = nameMatches;
    await markOrganizationProfileProvisioningStage({
      id: profile.id,
      logtoOrganizationId,
      nameCache: canonicalName,
      status: LOGTO_SYNC_STATUSES.METADATA_LINKED,
      errorMessage: null,
    });
    await recordAuditLogBestEffort({
      actorUserId: auditActorUserId,
      organizationId: logtoOrganizationId,
      action: AUDIT_ACTIONS.OWNER_ORGANIZATION_METADATA_RECONCILE,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: {
        stage: LOGTO_SYNC_STATUSES.METADATA_LINKED,
        reconciliation: "auto_linked_single_name_match",
        profileId: profile.id,
        logtoOrganizationId,
        organization: { id: logtoOrganizationId, name: canonicalName },
      },
    });
    changed = true;
  }

  return changed ? listOrganizationProfiles() : profiles;
}

const getSafeErrorMessage = (error) => {
  if (!error) return "Logto synchronization failed";
  const status = error.status ? ` (${error.status})` : "";
  return `${error.message || "Logto synchronization failed"}${status}`;
};

async function resolveLogtoOrganizationForSync({ name, description, customData }) {
  const existingOrganization = await findLogtoOrganizationByName(name);
  if (existingOrganization) {
    return { organization: existingOrganization, reconciled: true, source: "pre_create_name_lookup" };
  }

  const createdOrganization = await createLogtoOrganization({ name, description, customData });
  const createdOrganizationId = getLogtoOrganizationId(createdOrganization);
  if (createdOrganizationId) {
    return { organization: createdOrganization, reconciled: false, source: "create_response" };
  }

  const reconciledOrganization = await findLogtoOrganizationByName(name);
  if (reconciledOrganization) {
    return { organization: reconciledOrganization, reconciled: true, source: "post_create_name_lookup" };
  }

  const error = new Error("Logto organization creation succeeded but no organization id was returned or reconciled");
  error.logtoResponse = createdOrganization;
  throw error;
}

// Local base healthcheck. It intentionally does not depend on Logto or any external integration.
app.get("/health", async (req, res) => {
  const database = await checkDatabaseConnection();
  const healthy = database.ok;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    service: "civitas-api",
    timestamp: new Date().toISOString(),
    database: {
      status: healthy ? "connected" : "unavailable",
      host: database.host,
      port: database.port,
      name: database.database,
      ...(database.error ? { error: database.error } : {}),
    },
  });
});

app.get("/auth/test", requireAuth(API_RESOURCE), (req, res) => {
  res.json({
    status: "ok",
    message: "Authenticated with Logto API access token",
    user: {
      sub: req.user.sub,
      scopes: req.user.scopes,
    },
  });
});

app.get("/me", requireAuth(API_RESOURCE), async (req, res) => {
  try {
    const logtoIdentityClaims = await getLogtoIdentityClaimsBestEffort(req.user.sub);
    const enrichedAuthUser = {
      ...req.user,
      claims: { ...(req.user.claims || {}), ...logtoIdentityClaims, sub: req.user.sub },
    };
    const internalUser = await getOrCreateInternalUser(enrichedAuthUser);

    const identity = buildRequestIdentity(enrichedAuthUser, internalUser);

    return res.json({
      user: serializeUser(internalUser),
      identity,
      auth: {
        sub: req.user.sub,
        issuer: req.user.claims?.iss,
        audience: req.user.claims?.aud,
        scopes: req.user.scopes,
        organizationId: req.user.organizationId,
        token: buildSessionTokenMetadata(req.user.claims),
      },
    });
  } catch (error) {
    if (error.status === 401) {
      return res.status(401).json({ error: "Unauthorized", message: error.message });
    }

    if (error.status === 403) {
      return res.status(403).json({ error: "Forbidden", message: error.message });
    }

    console.error("Failed to resolve internal user", error);
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to resolve internal user" });
  }
});

app.get("/owner/me", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  try {
    const internalUser = await getOrCreateInternalUser(req.user);

    return res.json({
      owner: {
        logtoUserId: req.user.sub,
        internalUserId: internalUser.id,
        authorizedBy: "logto_scope",
        requiredScope: "owner:read",
        scopes: req.user.scopes,
      },
    });
  } catch (error) {
    if (error.status === 401) {
      return res.status(401).json({ error: "Unauthorized", message: error.message });
    }

    if (error.status === 403) {
      return res.status(403).json({ error: "Forbidden", message: error.message });
    }

    console.error("Failed to resolve owner metadata", error);
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to resolve owner metadata" });
  }
});

app.get("/organizations", requireAuth(API_RESOURCE), requireScope("organizations:read"), async (req, res) => {
  try {
    const [logtoOrganizations, rawProfiles] = await Promise.all([listLogtoOrganizations(), listOrganizationProfiles()]);
    const profiles = await reconcileProfilesWithLogtoOrganizations({ logtoOrganizations, profiles: rawProfiles });
    return res.json(buildLogtoOrganizationDirectory({ logtoOrganizations, profiles }));
  } catch (error) {
    console.error("Failed to list canonical Logto organizations", error);
    return res.status(502).json({ error: "Bad Gateway", message: "Failed to list organizations from Logto" });
  }
});

app.get("/owner/organization-template", requireAuth(API_RESOURCE), requireScope("organizations:read"), async (req, res) => {
  try {
    const roles = await listLogtoOrganizationRoles();
    const template = await ensureOrganizationTemplate().catch((error) => ({ ok: false, missingRoleNames: error.missingRoleNames || [], requiredRoleNames: [ORGANIZATION_ADMIN_ROLE_NAME] }));
    return res.json({
      roles: roles.map((role) => ({ id: role.id || role.organizationRoleId || role.roleId || role.name, name: role.name || role.nameCache || role.key })),
      requiredRoleNames: template.requiredRoleNames || [ORGANIZATION_ADMIN_ROLE_NAME],
      missingRoleNames: template.missingRoleNames || [],
      ready: Boolean(template.ok),
    });
  } catch (error) {
    console.error("Failed to inspect Logto organization template", error);
    return res.status(502).json({ error: "Bad Gateway", message: "Failed to inspect Logto organization template" });
  }
});

app.get("/owner/organizations", requireAuth(API_RESOURCE), requireScope("organizations:read"), async (req, res) => {
  try {
    const logtoOrganizations = await listLogtoOrganizations();
    const rawProfiles = await listOrganizationProfiles();
    const profiles = await reconcileProfilesWithLogtoOrganizations({ logtoOrganizations, profiles: rawProfiles });
    const directory = buildLogtoOrganizationDirectory({ logtoOrganizations, profiles });
    return res.json({ organizations: directory.organizations, unreconciledProfiles: directory.unreconciledProfiles });
  } catch (error) {
    console.error("Failed to list owner organizations from Logto", error);
    return res.status(502).json({ error: "Bad Gateway", message: "Failed to list canonical organizations from Logto" });
  }
});

app.post("/owner/organizations", requireAuth(API_RESOURCE), requireScope("organizations:create"), async (req, res) => {
  let internalUser = null;
  let profile = null;
  let logtoOrganization = null;
  let logtoOrganizationId = null;
  let bootstrapStage = LOGTO_SYNC_STATUSES.PENDING;
  const { errors, value } = validateOrganizationProvisioningInput(req.body || {});

  try {
    internalUser = await getOrCreateInternalUser(req.user);

    if (errors.length > 0) {
      await recordAuditLogBestEffort({ actorUserId: internalUser.id, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROFILE_CREATE, result: AUDIT_RESULTS.ERROR, metadata: { stage: "input_validation", reason: "validation_error", errors } });
      return res.status(400).json({ error: "Bad Request", message: errors[0].message, details: errors });
    }

    const duplicateProfile = await findOrganizationProfileBySlugOrAdminDomain({ slug: value.slug, adminDomain: value.adminDomain });
    if (duplicateProfile) {
      const duplicatedField = duplicateProfile.slug === value.slug ? "slug" : "adminDomain";
      return res.status(409).json({ error: "Conflict", message: `Organization ${duplicatedField} is already configured` });
    }

    const requestedRoleNames = Array.from(new Set([ORGANIZATION_ADMIN_ROLE_NAME, ...value.defaultRoleNames]));
    const template = await ensureOrganizationTemplate({ requiredRoleNames: requestedRoleNames });
    await recordAuditLogBestEffort({ actorUserId: internalUser.id, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_TEMPLATE_VALIDATE, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "template_validated", requiredRoleNames: requestedRoleNames, availableRoleNames: template.roles.map((role) => role.name).filter(Boolean) } });

    const adminRole = await findOrganizationRoleByName(ORGANIZATION_ADMIN_ROLE_NAME);
    const adminRoleId = adminRole?.id || adminRole?.organizationRoleId || adminRole?.roleId || null;
    if (!adminRoleId) throw new Error(`Logto organization role ${ORGANIZATION_ADMIN_ROLE_NAME} exists but no role id was returned`);

    const resolvedLogtoOrganization = await resolveLogtoOrganizationForSync({ name: value.name, description: value.description, customData: value.oidcInitialConfig });
    logtoOrganization = resolvedLogtoOrganization.organization;
    logtoOrganizationId = getLogtoOrganizationId(logtoOrganization);
    bootstrapStage = LOGTO_SYNC_STATUSES.LOGTO_CREATED;

    if (!logtoOrganizationId) throw new Error("Logto organization reconciliation did not include an organization id");

    await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_LOGTO_CREATE, result: AUDIT_RESULTS.SUCCESS, metadata: { ...buildAuditContext({ authUser: req.user, internalUser, organization: logtoOrganization }), stage: bootstrapStage, name: value.name, logtoOrganizationId, reconciled: resolvedLogtoOrganization.reconciled, source: resolvedLogtoOrganization.source } });

    profile = await upsertOrganizationProfile({
      logtoOrganizationId,
      nameCache: getLogtoOrganizationName(logtoOrganization) || value.name,
      type: value.type,
      subdomain: value.subdomain,
      slug: value.slug,
      adminDomain: value.adminDomain,
      organizationLoginExperienceEnabled: false,
      defaultRoleNames: value.defaultRoleNames,
      oidcApplicationId: value.oidcApplicationId,
      oidcInitialConfig: value.oidcInitialConfig,
      oidcApplicationSecretRef: value.oidcApplicationSecret,
      emailDomainProvisioningStatus: value.emailDomainProvisioningStatus,
      settings: { ...(value.settings || {}), baseAdmin: value.baseAdmin, supportDetailsVisible: true },
      seatTotal: value.seatTotal,
      logtoSyncStatus: LOGTO_SYNC_STATUSES.METADATA_LINKED,
    });
    bootstrapStage = LOGTO_SYNC_STATUSES.METADATA_LINKED;

    await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_METADATA_RECONCILE, result: AUDIT_RESULTS.SUCCESS, metadata: { ...buildAuditContext({ authUser: req.user, internalUser, organization: logtoOrganization }), stage: bootstrapStage, profileId: profile.id, logtoOrganizationId, localOnlyPreparedSettings: ["default_roles", "oidc_initial_config", "email_domain", "base_admin"] } });

    const baseAdminLogtoUserId = value.baseAdmin.logtoUserId || req.user.sub;
    profile = await markOrganizationProfileProvisioningStage({ id: profile.id, status: LOGTO_SYNC_STATUSES.BASE_MEMBER_PENDING, errorMessage: null });
    bootstrapStage = LOGTO_SYNC_STATUSES.BASE_MEMBER_PENDING;
    await addUserToLogtoOrganization({ organizationId: logtoOrganizationId, userId: baseAdminLogtoUserId });
    await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_BASE_MEMBER, result: AUDIT_RESULTS.SUCCESS, metadata: { ...buildAuditContext({ authUser: req.user, internalUser, organization: logtoOrganization }), stage: "base_member_added", baseAdmin: { ...value.baseAdmin, logtoUserId: baseAdminLogtoUserId } } });

    profile = await markOrganizationProfileProvisioningStage({ id: profile.id, status: LOGTO_SYNC_STATUSES.BASE_ROLE_PENDING, errorMessage: null });
    bootstrapStage = LOGTO_SYNC_STATUSES.BASE_ROLE_PENDING;
    await assignOrganizationRoleToUser({ organizationId: logtoOrganizationId, userId: baseAdminLogtoUserId, organizationRoleId: adminRoleId });
    await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_BASE_ROLE, result: AUDIT_RESULTS.SUCCESS, metadata: { ...buildAuditContext({ authUser: req.user, internalUser, organization: logtoOrganization }), stage: "base_role_assigned", roleName: ORGANIZATION_ADMIN_ROLE_NAME, roleId: adminRoleId, baseAdminLogtoUserId } });

    profile = await markOrganizationProfileProvisioningStage({ id: profile.id, logtoOrganizationId, nameCache: getLogtoOrganizationName(logtoOrganization) || value.name, status: LOGTO_SYNC_STATUSES.BOOTSTRAPPED, errorMessage: null, synced: true });
    bootstrapStage = LOGTO_SYNC_STATUSES.BOOTSTRAPPED;

    return res.status(201).json({ organization: serializeOwnerOrganization(profile, logtoOrganization) });
  } catch (error) {
    const errorMessage = getSafeErrorMessage(error);
    const status = error.code === "LOGTO_ORGANIZATION_TEMPLATE_MISSING_ROLES" ? 424 : logtoOrganizationId ? 201 : 502;

    if (profile?.id) {
      profile = await markOrganizationProfileLogtoSyncError({ id: profile.id, errorMessage, status: bootstrapStage }).catch((persistenceError) => {
        console.error(`Failed to persist provisioning error for organization profile ${profile?.id}`, persistenceError);
        return profile;
      });
    }

    await recordAuditLogBestEffort({ actorUserId: internalUser?.id ?? null, organizationId: logtoOrganizationId || profile?.id, action: error.code === "LOGTO_ORGANIZATION_TEMPLATE_MISSING_ROLES" ? AUDIT_ACTIONS.OWNER_ORGANIZATION_TEMPLATE_VALIDATE : AUDIT_ACTIONS.OWNER_ORGANIZATION_BOOTSTRAP_FAILED, result: AUDIT_RESULTS.ERROR, metadata: { ...buildAuditContext({ authUser: req.user, internalUser, organization: logtoOrganization }), profileId: profile?.id, name: value.name, logtoOrganizationId, stage: bootstrapStage, missingRoleNames: error.missingRoleNames, error: errorMessage } });

    console.error("Organization provisioning failed", error);
    if (status === 201) {
      return res.status(201).json({ organization: serializeOwnerOrganization(profile, logtoOrganization), warning: `Organization exists in Logto, but bootstrap stopped at ${bootstrapStage}: ${errorMessage}` });
    }

    return res.status(status).json({ error: status === 424 ? "Failed Dependency" : "Bad Gateway", message: errorMessage, stage: bootstrapStage, missingRoleNames: error.missingRoleNames });
  }
});

app.get("/owner/audit", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  try {
    await getOrCreateInternalUser(req.user);

    const logtoOrganizations = await listLogtoOrganizations().catch((error) => {
      console.error("Failed to enrich audit logs with Logto organization names", error);
      return [];
    });
    const result = await listAuditLogs(
      { limit: req.query.limit, offset: req.query.offset },
      { organizationNamesById: buildOrganizationNamesById(logtoOrganizations) }
    );
    return res.json(result);
  } catch (error) {
    if (error.status === 401) {
      return res.status(401).json({ error: "Unauthorized", message: error.message });
    }

    if (error.status === 403) {
      return res.status(403).json({ error: "Forbidden", message: error.message });
    }

    console.error("Failed to list audit logs", error);
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to list audit logs" });
  }
});

app.get(
  "/organizations/:organizationId/documents",
  requireOrganizationAccess({ requiredScopes: ["documents:read"] }),
  async (req, res) => {
    return res.json({
      organizationId: req.user.organizationId,
      documents: [],
      source: "organization_token",
    });
  }
);

app.post(
  "/organizations/:organizationId/documents",
  requireOrganizationAccess({ requiredScopes: ["documents:create"] }),
  async (req, res) => {
    return res.status(201).json({
      organizationId: req.user.organizationId,
      document: null,
      source: "organization_token",
      message: "Organization-scoped document creation placeholder",
    });
  }
);

app.get("/", (req, res) => {
  res.json({ message: "Welcome to the Civitas API", health: "/health" });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
