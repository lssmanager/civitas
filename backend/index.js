const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { requireAuth, requireOrganizationAccess, requireScope } = require("./middleware/auth");
const { requireOwner } = require("./middleware/owner");
const { checkDatabaseConnection } = require("./db/connection");
const { getIdentityFromLogtoClaims, getOrCreateInternalUser, serializeUser } = require("./services/users");
const {
  ORGANIZATION_ADMIN_ROLE_NAME,
  ensureOrganizationTemplate,
  getLogtoUserById,
  listLogtoOrganizationRoles,
  listLogtoOrganizations,
} = require("./services/logtoManagement");
const {
  LOGTO_SYNC_STATUSES,
  listOrganizationProfiles,
  markOrganizationProfileOrphaned,
  markOrganizationProfileProvisioningStage,
  serializeOrganizationProfile,
} = require("./services/organizationProfiles");
const {
  AUDIT_ACTIONS,
  AUDIT_RESULTS,
  listAuditLogs,
  recordAuditLogBestEffort,
} = require("./services/auditLogs");
const { normalizeCanonicalProvisioningInput, runCanonicalOrganizationBootstrap } = require("./services/organizationProvisioningCore");
const { buildLogtoOrganizationCustomData, normalizeExtendedProvisioningInput } = require("./services/organizationProvisioningSettings");

const app = express();
const port = process.env.PORT || 3000;
const API_RESOURCE = process.env.LOGTO_API_RESOURCE_INDICATOR;

app.use(cors());
app.use(express.json());

const getLogtoOrganizationId = (organization) => organization.id || organization.organizationId || organization.logtoOrganizationId;
const getLogtoOrganizationName = (organization) => organization.name || organization.nameCache || null;
const LEARNSOCIALSTUDIES_APP_HOST = "learnsocialstudies.com";

const getLogtoOrganizationCustomData = (organization = {}) => {
  const customData = organization.customData || organization.custom_data || {};
  return customData && typeof customData === "object" && !Array.isArray(customData) ? customData : {};
};

const deriveAppSubdomainFromOidcRedirectUri = (oidcRedirectUri) => {
  if (!oidcRedirectUri || typeof oidcRedirectUri !== "string") return null;

  try {
    const url = new URL(oidcRedirectUri);
    const hostname = url.hostname.toLowerCase();
    const suffix = `.${LEARNSOCIALSTUDIES_APP_HOST}`;
    if (!hostname.endsWith(suffix)) return null;

    const subdomain = hostname.slice(0, -suffix.length);
    return subdomain && !subdomain.includes(".") ? subdomain : null;
  } catch (error) {
    return null;
  }
};

const buildCanonicalLogtoOrganizationFields = (logtoOrganization = {}) => {
  const customData = getLogtoOrganizationCustomData(logtoOrganization);
  const provisioning = customData.provisioning && typeof customData.provisioning === "object" ? customData.provisioning : {};
  const oidcRedirectUri = typeof customData.oidcRedirectUri === "string" ? customData.oidcRedirectUri : null;
  const appSubdomain = typeof provisioning.appSubdomain === "string" && provisioning.appSubdomain
    ? provisioning.appSubdomain
    : deriveAppSubdomainFromOidcRedirectUri(oidcRedirectUri);

  return {
    name: getCanonicalLogtoOrganizationName(logtoOrganization),
    customData,
    oidcRedirectUri,
    appSubdomain,
    slug: typeof provisioning.slug === "string" ? provisioning.slug : null,
    adminDomain: typeof provisioning.institutionalDomain === "string" ? provisioning.institutionalDomain : null,
    visibleSource: "logto",
  };
};

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
  const logtoOrganizationIds = new Set(logtoOrganizations.map(getLogtoOrganizationId).filter(Boolean));
  const profilesByLogtoId = new Map();
  const profilesWithoutLogtoId = [];
  const orphanedProfiles = [];

  for (const profile of profiles) {
    if (profile.logtoOrganizationId) {
      if (logtoOrganizationIds.has(profile.logtoOrganizationId)) {
        const existingProfiles = profilesByLogtoId.get(profile.logtoOrganizationId) || [];
        existingProfiles.push(profile);
        profilesByLogtoId.set(profile.logtoOrganizationId, existingProfiles);
      } else {
        orphanedProfiles.push(profile);
      }
    } else {
      profilesWithoutLogtoId.push(profile);
    }
  }

  const matchedLegacyProfileIds = new Set();
  const organizations = logtoOrganizations
    .map((logtoOrganization) => {
      const logtoOrganizationId = getLogtoOrganizationId(logtoOrganization);
      if (!logtoOrganizationId) return null;

      const canonical = buildCanonicalLogtoOrganizationFields(logtoOrganization);
      const linkedProfiles = profilesByLogtoId.get(logtoOrganizationId) || [];
      const nameMatchedLegacyProfiles = profilesWithoutLogtoId.filter((profile) => profile.nameCache && canonical.name && profile.nameCache === canonical.name);

      for (const profile of nameMatchedLegacyProfiles) {
        matchedLegacyProfileIds.add(profile.id);
      }

      const associatedProfiles = sortProfilesByNewest([...linkedProfiles, ...nameMatchedLegacyProfiles]);
      const profile = associatedProfiles[0] || null;
      const duplicateProfileIds = associatedProfiles.slice(1).map((associatedProfile) => associatedProfile.id);
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
        name: canonical.name,
        canonical,
        logtoOrganization,
        profile: profile ? serializeOrganizationProfile(profile) : null,
        syncStatus: hasConflict ? "conflict" : profile?.logtoSyncStatus || "metadata_missing",
        syncError: hasConflict
          ? "Multiple internal profiles match this Logto organization; only the newest profile is used for operational state and the rest are reconciliation incidents."
          : profile?.logtoSyncError || null,
        reconciliation: {
          status: reconciliationStatus,
          profileCount: associatedProfiles.length,
          matchedBy: linkedProfiles.length > 0 ? "logto_organization_id" : nameMatchedLegacyProfiles.length > 0 ? "name" : null,
          profileIds: associatedProfiles.map((associatedProfile) => associatedProfile.id),
          canonicalProfileId: profile?.id || null,
          duplicateProfileIds,
        },
      };
    })
    .filter(Boolean);

  const staleUnlinkedProfiles = profilesWithoutLogtoId.filter((profile) => !matchedLegacyProfileIds.has(profile.id));
  const reconciliationIncidents = [
    ...orphanedProfiles.map((profile) => ({
      type: "orphaned_deleted_logto_organization",
      policy: "archived_out_of_operational_directory",
      profile: serializeOrganizationProfile(profile),
      message: "Local profile references a Logto organization that no longer exists; it is retained only for audit/reconciliation.",
    })),
    ...staleUnlinkedProfiles.map((profile) => ({
      type: "unlinked_legacy_profile",
      policy: "observability_only",
      profile: serializeOrganizationProfile(profile),
      message: "Local profile has no Logto organization id and did not match any current Logto organization by name; it is not part of the operational directory.",
    })),
  ];

  return {
    organizations,
    reconciliationIncidents,
    // Backwards-compatible alias for older clients; these are incidents, not operational organizations.
    unreconciledProfiles: reconciliationIncidents.map((incident) => incident.profile),
  };
}

async function reconcileProfilesWithLogtoOrganizations({ logtoOrganizations, profiles, auditActorUserId = null }) {
  const logtoOrganizationIds = new Set(logtoOrganizations.map(getLogtoOrganizationId).filter(Boolean));
  const profilesByLogtoId = new Map();
  const orphanProfiles = [];
  let changed = false;

  for (const profile of profiles) {
    if (profile.logtoOrganizationId) {
      if (logtoOrganizationIds.has(profile.logtoOrganizationId)) {
        const group = profilesByLogtoId.get(profile.logtoOrganizationId) || [];
        group.push(profile);
        profilesByLogtoId.set(profile.logtoOrganizationId, group);
      } else if (profile.status !== "orphaned" && profile.status !== "archived") {
        await markOrganizationProfileOrphaned({
          id: profile.id,
          errorMessage: `Logto organization ${profile.logtoOrganizationId} no longer exists; profile archived from operational directory`,
          settings: {
            ...(profile.settings || {}),
            orphanPolicy: {
              status: "orphaned",
              reason: "logto_organization_missing",
              archivedFromOperationalDirectoryAt: new Date().toISOString(),
              previousLogtoOrganizationId: profile.logtoOrganizationId,
            },
          },
        });
        await recordAuditLogBestEffort({
          actorUserId: auditActorUserId,
          organizationId: profile.logtoOrganizationId,
          action: AUDIT_ACTIONS.OWNER_ORGANIZATION_METADATA_RECONCILE,
          result: AUDIT_RESULTS.SUCCESS,
          metadata: {
            stage: "orphaned_deleted_logto_organization",
            policy: "archived_out_of_operational_directory",
            profileId: profile.id,
            logtoOrganizationId: profile.logtoOrganizationId,
          },
        });
        changed = true;
      }
    } else {
      orphanProfiles.push(profile);
    }
  }

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
  const requestPath = error.request?.path ? ` at ${error.request.method || "GET"} ${error.request.path}` : "";
  return `${error.message || "Logto synchronization failed"}${status}${requestPath}`;
};

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
    return res.json({ organizations: directory.organizations, reconciliationIncidents: directory.reconciliationIncidents, unreconciledProfiles: directory.unreconciledProfiles });
  } catch (error) {
    console.error("Failed to list owner organizations from Logto", error);
    return res.status(502).json({ error: "Bad Gateway", message: "Failed to list canonical organizations from Logto" });
  }
});

app.post("/owner/organizations", requireAuth(API_RESOURCE), requireScope("organizations:create"), async (req, res) => {
  let internalUser = null;
  let logtoOrganization = null;
  let logtoOrganizationId = null;
  let canonicalCreated = false;

  const canonicalInput = normalizeCanonicalProvisioningInput(req.body || {});
  const extendedInput = normalizeExtendedProvisioningInput(req.body || {});
  const errors = [...canonicalInput.errors, ...extendedInput.errors];
  const value = { ...canonicalInput.value, ...extendedInput.value };

  try {
    internalUser = await getOrCreateInternalUser(req.user);

    if (errors.length > 0) {
      await recordAuditLogBestEffort({ actorUserId: internalUser.id, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROFILE_CREATE, result: AUDIT_RESULTS.ERROR, metadata: { stage: "input_validation", reason: "validation_error", errors } });
      return res.status(400).json({ error: "Bad Request", message: errors[0].message, details: errors });
    }

    const result = await runCanonicalOrganizationBootstrap({
      canonical: canonicalInput.value,
      logtoCustomData: buildLogtoOrganizationCustomData(extendedInput.value),
      internalUser,
      auditContextBuilder: ({ organization }) => buildAuditContext({ authUser: req.user, internalUser, organization }),
    });

    logtoOrganization = result.logtoOrganization;
    logtoOrganizationId = result.logtoOrganizationId;
    canonicalCreated = result.canonicalCreated;

    return res.status(201).json({
      organization: serializeOwnerOrganization(null, logtoOrganization),
      status: result.status,
      sourceOfTruth: "logto",
      customDataApplied: result.customDataApplied,
      reconciled: result.reconciled,
      adminAssignment: result.adminAssignment,
      ...(result.adminAssignment?.status === "skipped_missing_logto_user_id" ? { warning: result.adminAssignment.message } : {}),
    });
  } catch (error) {
    if (error.provisioningState) {
      logtoOrganization = error.provisioningState.logtoOrganization || logtoOrganization;
      logtoOrganizationId = error.provisioningState.logtoOrganizationId || logtoOrganizationId;
      canonicalCreated = error.provisioningState.canonicalCreated || canonicalCreated;
    }

    const errorMessage = getSafeErrorMessage(error);
    const logtoFailure = Boolean(error.request || error.status || error.code?.startsWith?.("LOGTO_"));

    await recordAuditLogBestEffort({
      actorUserId: internalUser?.id ?? null,
      organizationId: logtoOrganizationId,
      action: error.code === "LOGTO_ORGANIZATION_TEMPLATE_MISSING_ROLES" ? AUDIT_ACTIONS.OWNER_ORGANIZATION_TEMPLATE_VALIDATE : AUDIT_ACTIONS.OWNER_ORGANIZATION_BOOTSTRAP_FAILED,
      result: AUDIT_RESULTS.ERROR,
      metadata: {
        ...buildAuditContext({ authUser: req.user, internalUser, organization: logtoOrganization }),
        name: value.name,
        logtoOrganizationId,
        canonicalCreated,
        error: errorMessage,
        logtoRequest: error.request,
        logtoErrorBody: error.body,
        diagnostic: error.diagnostic,
      },
    });

    console.error("Organization creation through Logto failed", error);
    if (canonicalCreated && logtoOrganizationId) {
      return res.status(201).json({
        organization: serializeOwnerOrganization(null, logtoOrganization),
        status: "created_in_logto_with_followup_failure",
        sourceOfTruth: "logto",
        warning: `Organization was created canonically in Logto, but a non-canonical follow-up step failed: ${errorMessage}`,
        failedStep: error.code === "LOGTO_ORGANIZATION_TEMPLATE_MISSING_ROLES" ? "admin_role_template_validation" : "base_admin_assignment",
        followUpError: { message: errorMessage, status: error.status || null, request: error.request || null, body: error.body || null },
      });
    }

    const status = error.code === "LOGTO_ORGANIZATION_TEMPLATE_MISSING_ROLES" ? 424 : 502;
    return res.status(status).json({
      error: status === 424 ? "Failed Dependency" : "Bad Gateway",
      message: errorMessage,
      sourceOfTruth: "logto",
      integration: logtoFailure ? "logto_management_api" : "unknown",
      diagnostic: error.diagnostic || null,
      logtoRequest: error.request || null,
      logtoErrorBody: error.body || null,
      missingRoleNames: error.missingRoleNames,
    });
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
