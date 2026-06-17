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
  updateLogtoUser,
  listLogtoOrganizationRoles,
  listLogtoOrganizations,
} = require("./services/logtoManagement");
const {
  LOGTO_SYNC_STATUSES,
  listOrganizationProfiles,
  serializeOrganizationProfile,
  upsertOrganizationProfile,
} = require("./services/organizationProfiles");
const {
  AUDIT_ACTIONS,
  AUDIT_RESULTS,
  listAuditLogs,
  recordAuditLogBestEffort,
} = require("./services/auditLogs");
const { normalizeCanonicalProvisioningInput, runCanonicalOrganizationBootstrap } = require("./services/organizationProvisioningCore");
const { buildLogtoOrganizationCustomData, normalizeExtendedProvisioningInput } = require("./services/organizationProvisioningSettings");
const { FluentCrmError, ensureOrganizationTagsAndLists, getOrCreateCompanyForOrganization, normalizeCrmCompanyInput, updateContactEmailAfterLogtoChange } = require("./services/fluentCrm");

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

const serializeLogtoOwnerOrganization = (logtoOrganization = null, fallbackLogtoOrganizationId = null) => ({
  logtoOrganizationId: (logtoOrganization ? getLogtoOrganizationId(logtoOrganization) : null) || fallbackLogtoOrganizationId || null,
  name: logtoOrganization ? getLogtoOrganizationName(logtoOrganization) : null,
  logtoOrganization: logtoOrganization || null,
  profile: null,
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

  const logtoNameCounts = logtoOrganizations.reduce((counts, organization) => {
    const name = getCanonicalLogtoOrganizationName(organization);
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
    return counts;
  }, new Map());
  const matchedLegacyProfileIds = new Set();
  const organizations = logtoOrganizations
    .map((logtoOrganization) => {
      const logtoOrganizationId = getLogtoOrganizationId(logtoOrganization);
      if (!logtoOrganizationId) return null;

      const canonical = buildCanonicalLogtoOrganizationFields(logtoOrganization);
      const linkedProfiles = profilesByLogtoId.get(logtoOrganizationId) || [];
      const canSafelyMatchLegacyByName = Boolean(canonical.name) && logtoNameCounts.get(canonical.name) === 1;
      const nameMatchedLegacyProfiles = canSafelyMatchLegacyByName
        ? profilesWithoutLogtoId.filter((profile) => profile.nameCache === canonical.name && !matchedLegacyProfileIds.has(profile.id))
        : [];

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

function reconcileProfilesWithLogtoOrganizations({ profiles }) {
  // Read-scoped directory requests must not mutate local reconciliation state.
  // Orphaning/linking decisions are detected in buildLogtoOrganizationDirectory and
  // should be persisted only by an explicit write-scoped reconciliation job/endpoint.
  return profiles;
}


async function runFluentCrmOrganizationStep({ logtoOrganization, logtoOrganizationId, canonical, extended, crmInput, internalUser, authUser }) {
  const profile = await upsertOrganizationProfile({
    logtoOrganizationId,
    nameCache: getLogtoOrganizationName(logtoOrganization) || canonical.name,
    type: extended.type || null,
    subdomain: extended.subdomain,
    slug: extended.slug,
    adminDomain: extended.adminDomain,
    seatTotal: extended.seatTotal,
    logtoSyncStatus: LOGTO_SYNC_STATUSES.BOOTSTRAPPED,
    logtoSyncError: null,
  });

  const normalizedCrm = normalizeCrmCompanyInput(crmInput, {
    name: canonical.name,
    nameCache: profile.nameCache,
    adminDomain: profile.adminDomain,
  });

  const companyResult = await getOrCreateCompanyForOrganization(
    profile,
    { ...normalizedCrm, name: canonical.name, slug: extended.slug, adminDomain: extended.adminDomain },
    { actorUserId: internalUser.id, auditMetadata: buildAuditContext({ authUser, internalUser, organization: logtoOrganization }) }
  );

  if (companyResult.status === "conflict") {
    return {
      status: "conflict",
      message: `FluentCRM company match is ambiguous (${companyResult.reason}); Civitas did not link a Company automatically.`,
      reason: companyResult.reason,
    };
  }

  const taxonomy = await ensureOrganizationTagsAndLists({
    logtoOrganizationId,
    slug: extended.slug,
    name: canonical.name,
  });

  return {
    profile,
    status: companyResult.status,
    companyId: companyResult.company?.id ?? companyResult.company?.ID ?? companyResult.company?.company_id ?? null,
    reason: companyResult.reason,
    taxonomy,
  };
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

    let fluentCrmStep = { status: "not_requested" };
    let crmWarning = null;
    try {
      fluentCrmStep = await runFluentCrmOrganizationStep({
        logtoOrganization,
        logtoOrganizationId,
        canonical: canonicalInput.value,
        extended: extendedInput.value,
        crmInput: req.body?.crm || req.body?.fluentcrm || {},
        internalUser,
        authUser: req.user,
      });
      if (fluentCrmStep.status === "conflict") crmWarning = fluentCrmStep.message;
    } catch (crmError) {
      const crmMessage = getSafeErrorMessage(crmError);
      crmWarning = `Organization was created in Logto, but FluentCRM sync failed: ${crmMessage}`;
      fluentCrmStep = { status: "error", message: crmMessage, code: crmError.code || null };
    }

    return res.status(201).json({
      organization: fluentCrmStep.profile ? serializeOwnerOrganization(fluentCrmStep.profile, logtoOrganization) : serializeLogtoOwnerOrganization(logtoOrganization, logtoOrganizationId),
      status: crmWarning ? "created_in_logto_with_fluentcrm_followup" : result.status,
      sourceOfTruth: "logto",
      customDataApplied: result.customDataApplied,
      reconciled: result.reconciled,
      steps: {
        logtoOrganization: { status: result.reconciled ? "reconciled" : "created", id: logtoOrganizationId },
        baseAdminUser: { status: result.adminAssignment?.userCreated ? "created" : "resolved", logtoUserId: result.adminAssignment?.logtoUserId, source: result.adminAssignment?.userSource },
        baseAdminMembership: { status: result.adminAssignment?.membershipAdded ? "added" : "not_added" },
        baseAdminRole: { status: result.adminAssignment?.roleAssigned ? "assigned" : "not_assigned", roleName: result.adminAssignment?.roleName },
        jitProvisioning: { status: result.jitProvisioning?.status, domainConfigured: result.jitProvisioning?.domainConfigured, domain: result.jitProvisioning?.domain },
        jitDefaultRoles: { status: result.jitProvisioning?.defaultRolesConfigured ? "configured" : "not_configured", roleNames: result.jitProvisioning?.defaultRoleNames },
        fluentcrm: fluentCrmStep,
      },
      fluentcrm: fluentCrmStep,
      warning: crmWarning || undefined,
      adminAssignment: result.adminAssignment,
      jitProvisioning: result.jitProvisioning,
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
        organization: serializeLogtoOwnerOrganization(logtoOrganization, logtoOrganizationId),
        status: "created_in_logto_with_followup_failure",
        sourceOfTruth: "logto",
        warning: `Organization was created canonically in Logto, but a non-canonical follow-up step failed: ${errorMessage}`,
        failedStep: error.request?.path?.includes("/jit/email-domains") ? "jit_email_domain_configuration" : error.request?.path?.includes("/jit/roles") ? "jit_default_roles_configuration" : error.request?.path?.includes("/users") ? "base_admin_user_resolution" : error.request?.path?.includes("/roles") ? "base_admin_role_assignment" : error.code === "LOGTO_ORGANIZATION_TEMPLATE_MISSING_ROLES" ? "organization_template_validation" : "base_admin_or_jit_followup",
        followUpError: { message: errorMessage, status: error.status || null, request: error.request || null, body: error.body || null },
      });
    }

    const status = error.code === "LOGTO_ORGANIZATION_TEMPLATE_MISSING_ROLES" ? 424 : error.status || 502;
    return res.status(status).json({
      error: status === 424 ? "Failed Dependency" : status === 500 ? "Internal Server Error" : "Bad Gateway",
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


app.patch("/owner/organizations/:organizationId/fluentcrm", requireAuth(API_RESOURCE), requireScope("organizations:create"), async (req, res) => {
  let internalUser = null;
  try {
    internalUser = await getOrCreateInternalUser(req.user);
    const profiles = await listOrganizationProfiles();
    const profile = profiles.find((item) => item.id === req.params.organizationId || item.logtoOrganizationId === req.params.organizationId);
    if (!profile) return res.status(404).json({ error: "Not Found", message: "Organization profile not found for FluentCRM sync" });

    const result = await getOrCreateCompanyForOrganization(
      profile,
      { crm: req.body?.crm || req.body || {}, name: profile.nameCache, adminDomain: profile.adminDomain, slug: profile.slug },
      { actorUserId: internalUser.id, auditMetadata: buildAuditContext({ authUser: req.user, internalUser, organization: { id: profile.logtoOrganizationId, name: profile.nameCache } }) }
    );
    const taxonomy = result.status === "conflict" ? null : await ensureOrganizationTagsAndLists({ logtoOrganizationId: profile.logtoOrganizationId, slug: profile.slug, name: profile.nameCache });
    return res.json({ status: result.status, fluentcrm: { ...result, taxonomy } });
  } catch (error) {
    const status = error instanceof FluentCrmError ? (error.status || 502) : error.status || 500;
    return res.status(status).json({ error: status === 409 ? "Conflict" : status >= 500 ? "Bad Gateway" : "Bad Request", message: getSafeErrorMessage(error), integration: "fluentcrm", code: error.code || null });
  }
});

app.patch("/owner/organizations/:organizationId/members/:logtoUserId/identity", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  let internalUser = null;
  try {
    internalUser = await getOrCreateInternalUser(req.user);
    const previousEmail = typeof req.body?.previousEmail === "string" ? req.body.previousEmail.trim().toLowerCase() : null;
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : null;
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : null;
    const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : null;
    if (!email || !previousEmail) return res.status(400).json({ error: "Bad Request", message: "email and previousEmail are required" });

    const logtoUser = await updateLogtoUser({ userId: req.params.logtoUserId, email, name, phone });
    await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: req.params.organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "logto_identity_updated", logtoUserId: req.params.logtoUserId, previousEmail, email } });

    let fluentcrm = null;
    try {
      fluentcrm = await updateContactEmailAfterLogtoChange({ previousEmail, newEmail: email, logtoUserId: req.params.logtoUserId, logtoOrganizationId: req.params.organizationId, profile: { name, phone } });
      await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: req.params.organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_SYNC, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "fluentcrm_contact_identity_updated", logtoUserId: req.params.logtoUserId, previousEmail, email, fluentcrmStatus: fluentcrm.status } });
    } catch (crmError) {
      fluentcrm = { status: "error", message: getSafeErrorMessage(crmError), code: crmError.code || null };
      await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: req.params.organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_ERROR, result: AUDIT_RESULTS.ERROR, metadata: { stage: "fluentcrm_contact_identity_update_failed", logtoUserId: req.params.logtoUserId, previousEmail, email, error: crmError } });
    }

    return res.json({ status: fluentcrm?.status === "error" ? "logto_updated_fluentcrm_failed" : "updated", logtoUser, fluentcrm, futureSelfServiceRoute: "PATCH /me/identity" });
  } catch (error) {
    return res.status(error.status || 502).json({ error: "Bad Gateway", message: getSafeErrorMessage(error), integration: "logto_management_api", logtoRequest: error.request || null, logtoErrorBody: error.body || null });
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
