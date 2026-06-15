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
  findLogtoOrganizationByName,
  findOrganizationRoleByName,
  getLogtoUserById,
  listLogtoOrganizations,
} = require("./services/logtoManagement");
const {
  LOGTO_SYNC_STATUSES,
  listOrganizationProfiles,
  markOrganizationProfileLogtoSyncError,
  markOrganizationProfileLogtoSynced,
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

const getSafeErrorMessage = (error) => {
  if (!error) return "Logto synchronization failed";
  const status = error.status ? ` (${error.status})` : "";
  return `${error.message || "Logto synchronization failed"}${status}`;
};

async function resolveLogtoOrganizationForSync({ name, description }) {
  const existingOrganization = await findLogtoOrganizationByName(name);
  if (existingOrganization) {
    return { organization: existingOrganization, reconciled: true, source: "pre_create_name_lookup" };
  }

  const createdOrganization = await createLogtoOrganization({ name, description });
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
    const [logtoOrganizations, profiles] = await Promise.all([listLogtoOrganizations(), listOrganizationProfiles()]);
    return res.json(buildLogtoOrganizationDirectory({ logtoOrganizations, profiles }));
  } catch (error) {
    console.error("Failed to list canonical Logto organizations", error);
    return res.status(502).json({ error: "Bad Gateway", message: "Failed to list organizations from Logto" });
  }
});

app.get("/owner/organizations", requireAuth(API_RESOURCE), requireScope("organizations:read"), async (req, res) => {
  try {
    const [logtoOrganizations, profiles] = await Promise.all([listLogtoOrganizations(), listOrganizationProfiles()]);
    const directory = buildLogtoOrganizationDirectory({ logtoOrganizations, profiles });
    return res.json({ organizations: directory.organizations, unreconciledProfiles: directory.unreconciledProfiles });
  } catch (error) {
    console.error("Failed to list owner organizations from Logto", error);
    return res.status(502).json({ error: "Bad Gateway", message: "Failed to list organizations from Logto" });
  }
});

app.post("/owner/organizations", requireAuth(API_RESOURCE), requireScope("organizations:create"), async (req, res) => {
  let internalUser = null;
  let profile = null;
  let logtoOrganization = null;
  let logtoOrganizationId = null;
  const { name, description, type, subdomain, slug, adminDomain, logoUrl, faviconUrl, primaryColor, primaryColorDark, organizationLoginExperienceEnabled, defaultRoleNames, oidcInitialConfig, oidcApplicationSecret, settings, seatTotal } = req.body || {};
  const normalizedName = typeof name === "string" ? name.trim() : "";

  try {
    internalUser = await getOrCreateInternalUser(req.user);

    if (!normalizedName) {
      await recordAuditLogBestEffort({
        actorUserId: internalUser.id,
        action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROFILE_CREATE,
        result: AUDIT_RESULTS.ERROR,
        metadata: { reason: "validation_error", field: "name" },
      });
      return res.status(400).json({ error: "Bad Request", message: "Organization name is required" });
    }

    const resolvedLogtoOrganization = await resolveLogtoOrganizationForSync({ name: normalizedName, description });
    logtoOrganization = resolvedLogtoOrganization.organization;
    const {
      reconciled,
      source: logtoOrganizationSource,
    } = resolvedLogtoOrganization;
    logtoOrganizationId = getLogtoOrganizationId(logtoOrganization);

    if (!logtoOrganizationId) {
      throw new Error("Logto organization reconciliation did not include an organization id");
    }

    await recordAuditLogBestEffort({
      actorUserId: internalUser.id,
      organizationId: logtoOrganizationId,
      action: AUDIT_ACTIONS.OWNER_ORGANIZATION_LOGTO_CREATE,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: { ...buildAuditContext({ authUser: req.user, internalUser, organization: logtoOrganization }), name: normalizedName, logtoOrganizationId, reconciled, source: logtoOrganizationSource },
    });

    profile = await upsertOrganizationProfile({
      logtoOrganizationId,
      nameCache: getLogtoOrganizationName(logtoOrganization) || normalizedName,
      type,
      subdomain,
      slug,
      adminDomain,
      logoUrl,
      faviconUrl,
      primaryColor,
      primaryColorDark,
      organizationLoginExperienceEnabled,
      defaultRoleNames: Array.isArray(defaultRoleNames) ? defaultRoleNames : [],
      oidcInitialConfig: oidcInitialConfig && typeof oidcInitialConfig === "object" ? oidcInitialConfig : null,
      oidcApplicationSecretRef: oidcApplicationSecret ? `configured:${new Date().toISOString()}` : null,
      settings: settings && typeof settings === "object" ? settings : null,
      seatTotal,
      logtoSyncStatus: LOGTO_SYNC_STATUSES.LOGTO_CREATED,
    });

    await recordAuditLogBestEffort({
      actorUserId: internalUser.id,
      organizationId: logtoOrganizationId,
      action: AUDIT_ACTIONS.OWNER_ORGANIZATION_METADATA_RECONCILE,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: { ...buildAuditContext({ authUser: req.user, internalUser, organization: logtoOrganization }), profileId: profile.id, logtoOrganizationId, status: profile.logtoSyncStatus },
    });

    profile = await markOrganizationProfileProvisioningStage({
      id: profile.id,
      status: LOGTO_SYNC_STATUSES.CREATOR_MEMBERSHIP_PENDING,
    });
    await addUserToLogtoOrganization({ organizationId: logtoOrganizationId, userId: req.user.sub });

    await recordAuditLogBestEffort({
      actorUserId: internalUser.id,
      organizationId: logtoOrganizationId,
      action: AUDIT_ACTIONS.OWNER_ORGANIZATION_CREATOR_MEMBERSHIP,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: { ...buildAuditContext({ authUser: req.user, internalUser, organization: logtoOrganization }), profileId: profile.id, logtoOrganizationId, logtoUserId: req.user.sub },
    });

    profile = await markOrganizationProfileProvisioningStage({
      id: profile.id,
      status: LOGTO_SYNC_STATUSES.CREATOR_ROLE_PENDING,
    });
    const adminRole = await findOrganizationRoleByName(ORGANIZATION_ADMIN_ROLE_NAME);
    if (!adminRole?.id) {
      const roleError = new Error(
        `Logto organization role not found in organization template: ${ORGANIZATION_ADMIN_ROLE_NAME}`
      );
      roleError.code = "LOGTO_ORGANIZATION_ROLE_MISSING";
      await markOrganizationProfileProvisioningStage({
        id: profile.id,
        status: LOGTO_SYNC_STATUSES.CREATOR_ROLE_MISSING,
        errorMessage: roleError.message,
      });
      throw roleError;
    }

    await assignOrganizationRoleToUser({
      organizationId: logtoOrganizationId,
      userId: req.user.sub,
      organizationRoleId: adminRole.id,
    });

    profile = await markOrganizationProfileLogtoSynced({
      id: profile.id,
      logtoOrganizationId,
      nameCache: getLogtoOrganizationName(logtoOrganization) || normalizedName,
    });

    await recordAuditLogBestEffort({
      actorUserId: internalUser.id,
      organizationId: logtoOrganizationId,
      action: AUDIT_ACTIONS.OWNER_ORGANIZATION_CREATOR_ROLE,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: { ...buildAuditContext({ authUser: req.user, internalUser, organization: logtoOrganization }), profileId: profile.id, logtoOrganizationId, roleName: ORGANIZATION_ADMIN_ROLE_NAME, roleId: adminRole.id },
    });

    await recordAuditLogBestEffort({
      actorUserId: internalUser.id,
      organizationId: logtoOrganizationId,
      action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: { ...buildAuditContext({ authUser: req.user, internalUser, organization: logtoOrganization }), profileId: profile.id, logtoOrganizationId, finalStatus: profile.logtoSyncStatus },
    });

    return res.status(201).json({ organization: serializeOwnerOrganization(profile, logtoOrganization) });
  } catch (error) {
    const errorMessage = getSafeErrorMessage(error);
    const pendingStatus = error?.code === "LOGTO_ORGANIZATION_ROLE_MISSING"
      ? LOGTO_SYNC_STATUSES.CREATOR_ROLE_MISSING
      : profile?.logtoSyncStatus || (logtoOrganizationId ? LOGTO_SYNC_STATUSES.LOGTO_CREATED : LOGTO_SYNC_STATUSES.ERROR);

    if (profile?.id) {
      profile = await markOrganizationProfileLogtoSyncError({ id: profile.id, errorMessage, status: pendingStatus }).catch((persistenceError) => {
        console.error(`Failed to persist provisioning error for organization profile ${profile?.id}`, persistenceError);
        return profile;
      });
    }

    const failedAction = pendingStatus === LOGTO_SYNC_STATUSES.CREATOR_ROLE_PENDING
 || pendingStatus === LOGTO_SYNC_STATUSES.CREATOR_ROLE_MISSING
      ? AUDIT_ACTIONS.OWNER_ORGANIZATION_CREATOR_ROLE
      : pendingStatus === LOGTO_SYNC_STATUSES.CREATOR_MEMBERSHIP_PENDING
        ? AUDIT_ACTIONS.OWNER_ORGANIZATION_CREATOR_MEMBERSHIP
        : logtoOrganizationId
          ? AUDIT_ACTIONS.OWNER_ORGANIZATION_METADATA_RECONCILE
          : AUDIT_ACTIONS.OWNER_ORGANIZATION_LOGTO_CREATE;

    await recordAuditLogBestEffort({
      actorUserId: internalUser?.id ?? null,
      organizationId: logtoOrganizationId || profile?.id,
      action: failedAction,
      result: AUDIT_RESULTS.ERROR,
      metadata: { ...buildAuditContext({ authUser: req.user, internalUser, organization: logtoOrganization }), profileId: profile?.id, name: normalizedName || name, logtoOrganizationId, status: pendingStatus, error: errorMessage },
    });

    await recordAuditLogBestEffort({
      actorUserId: internalUser?.id ?? null,
      organizationId: logtoOrganizationId || profile?.id,
      action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING,
      result: AUDIT_RESULTS.ERROR,
      metadata: { ...buildAuditContext({ authUser: req.user, internalUser, organization: logtoOrganization }), profileId: profile?.id, logtoOrganizationId, finalStatus: profile?.logtoSyncStatus || pendingStatus, error: errorMessage },
    });

    console.error("Organization provisioning failed", error);
    if (profile?.id || logtoOrganizationId) {
      return res.status(201).json({
        organization: serializeOwnerOrganization(profile, logtoOrganization),
        warning: "Organization exists in Logto, but Civitas bootstrap is incomplete",
      });
    }

    return res.status(502).json({ error: "Bad Gateway", message: "Failed to create organization in Logto" });
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
