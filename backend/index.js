const express = require("express");
const cors = require("cors");
const { eq } = require("drizzle-orm");
require("dotenv").config();
const { requireAuth, requireOrganizationAccess, requireScope } = require("./middleware/auth");
const { requireOwner } = require("./middleware/owner");
const { checkDatabaseConnection } = require("./db/connection");
const { getIdentityFromLogtoClaims, getOrCreateInternalUser, serializeUser } = require("./services/users");
const {
  ORGANIZATION_ADMIN_ROLE_NAME,
  ensureOrganizationTemplate,
  getLogtoUserById,
  getLogtoOrganizationById,
  removeUserFromLogtoOrganization,
  updateLogtoOrganization,
  updateLogtoUser,
  listLogtoOrganizationRoles,
  listLogtoOrganizationUserRoles,
  listLogtoOrganizationUsers,
  listLogtoOrganizations,
} = require("./services/logtoManagement");
const {
  LOGTO_SYNC_STATUSES,
  listOrganizationProfiles,
  markOrganizationProfileFluentCrmSync,
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
const {
  FluentCrmError,
  cleanupContactInFluentCrm,
  ensureOrganizationTagsAndLists,
  getOrCreateCompanyForOrganization,
  normalizeCrmCompanyInput,
  searchCompanies,
  searchContacts,
  syncOrganizationContactsToFluentCrm,
  upsertContactFromLogtoIdentity,
  validateFluentCrmConfiguration,
  updateContactEmailAfterLogtoChange,
} = require("./services/fluentCrm");
const {
  buildRoleMappingResponse,
  getEffectiveCrmRoleMapping,
  loadCrmRoleMappingReadModel,
  resetCrmRoleMappings,
  upsertCrmRoleMappings,
} = require("./services/crmRoleMappings");
const {
  loadWordPressRoleMappingReadModel,
  listWordPressRoles,
  resetWordPressRoleMappings,
  upsertWordPressRoleMappings,
} = require("./services/wordpressRoles");
const { db } = require("./db/client");
const { crmRoleMappings, organizationProfiles, wordpressRoleMappings } = require("./db/schema");
const { getCommercialStatusForOrganization, getLatestCommercialEventsForOrganization, processCommercialEvent, verifyCommercialWebhookSignature } = require("./services/commercialEvents");
const { getWorkerHealthSnapshot, loadOperationsSummary } = require("./services/operationalObservability");
const { createSyncOperation, listOrganizationEvents, listOrganizationPendingSync, retrySyncOperation, safeFunctionalMessage } = require("./services/syncOperations");
const { buildLogtoOrganizationBrandingCss } = require("./services/brandingCss");

const app = express();
const port = process.env.PORT || 3000;
const API_RESOURCE = process.env.LOGTO_API_RESOURCE_INDICATOR;

app.use(cors());
app.use(express.json({
  verify: (req, _res, buffer) => {
    req.rawBody = buffer.toString("utf8");
  },
}));

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
    unreconciledProfiles: reconciliationIncidents.map((incident) => incident.profile),
  };
}

function reconcileProfilesWithLogtoOrganizations({ profiles }) {
  return profiles;
}

async function runFluentCrmOrganizationStep({ logtoOrganization, logtoOrganizationId, canonical, extended, crmInput, administrativeContactAssignments = [], internalUser, authUser }) {
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

  const companyId = companyResult.company?.id ?? companyResult.company?.ID ?? companyResult.company?.company_id ?? null;
  const taxonomy = await ensureOrganizationTagsAndLists({
    logtoOrganizationId,
    slug: extended.slug,
    name: canonical.name,
  });
  const organizationLists = [...new Set([...(normalizedCrm.lists || []), taxonomy.list?.title].filter(Boolean))];
  const administrativeContacts = [];

  for (const assignment of administrativeContactAssignments) {
    const contactSync = await upsertContactFromLogtoIdentity({
      identity: {
        logtoUserId: assignment.logtoUserId,
        email: assignment.email,
        name: assignment.name,
        phone: assignment.phone,
        position: assignment.position,
      },
      companyId,
      roleNames: [assignment.roleName || assignment.organizationRoleName].filter(Boolean),
      extraLists: organizationLists,
    });
    administrativeContacts.push({
      key: assignment.key,
      name: assignment.name,
      email: assignment.email,
      phone: assignment.phone,
      position: assignment.position,
      logtoUserId: assignment.logtoUserId,
      roleName: assignment.roleName || assignment.organizationRoleName,
      contactSync,
    });
  }

  return {
    profile,
    status: companyResult.status,
    companyId,
    reason: companyResult.reason,
    taxonomy,
    administrativeContacts,
  };
}

const getLogtoUserIdentityFields = (user = {}) => ({
  logtoUserId: user.id || user.userId || user.logtoUserId || user.sub || null,
  name: user.name || user.profile?.name || null,
  email: user.primaryEmail || user.email || user.profile?.email || null,
  phone: user.primaryPhone || user.phone || user.profile?.phone || null,
  username: user.username || user.profile?.username || null,
  avatarUrl: user.avatar || user.avatarUrl || user.profile?.picture || null,
  mfa: {
    enabled: Array.isArray(user.mfaVerifications) ? user.mfaVerifications.length > 0 : user.mfaEnabled ?? user.mfa?.enabled ?? user.twoFactorEnabled ?? null,
    method: Array.isArray(user.mfaVerifications) ? user.mfaVerifications.map((factor) => factor.type || factor.usageType || factor).filter(Boolean).join(", ") || null : user.mfa?.method || null,
    availability: Array.isArray(user.mfaVerifications) || user.mfaEnabled !== undefined || user.mfa?.enabled !== undefined || user.twoFactorEnabled !== undefined ? "available_from_logto" : "not_available_from_provider",
  },
  connections: Array.isArray(user.identities) ? user.identities.map((identity) => identity.provider || identity.connectorId).filter(Boolean) : Array.isArray(user.ssoIdentities) ? user.ssoIdentities.map((identity) => identity.issuer || identity.connectorId).filter(Boolean) : [],
  lastLoginAt: user.lastSignInAt || user.lastLoginAt || user.updatedAt || null,
  sessions: { availability: "not_loaded", note: "Logto session details require provider-specific session endpoints; Civitas does not mirror sessions locally." },
  spentTime: { availability: "not_available", value: null, note: "No reliable Logto v1.40.1 aggregate spent-time signal is persisted in Civitas." },
});

const getCrmExclusiveFields = (contact = {}, company = null) => ({
  company: contact.company || contact.company_name || company?.name || company?.title || null,
  industry: contact.industry || company?.industry || null,
  companyOwner: contact.company_owner || contact.owner || company?.owner || null,
  numberOfEmployees: contact.number_of_employees ?? company?.number_of_employees ?? null,
  lifecycleStage: contact.lifecycle_stage || contact.status || null,
  lists: Array.isArray(contact.lists) ? contact.lists.map((item) => item.title || item.name || item).filter(Boolean) : [],
  tags: Array.isArray(contact.tags) ? contact.tags.map((item) => item.title || item.name || item).filter(Boolean) : [],
  previousEmailAddress: contact.previous_email_address || contact.previous_email || contact.custom_values?.previous_email || null,
  customerNotes: contact.customer_notes || contact.notes || null,
  purchaseSummary: contact.purchase_summary || contact.purchase_history || null,
  subscriptionSummary: contact.subscription_summary || contact.subscription_metadata || null,
});

async function getCrmDirectoryBlock({ email, profile }) {
  try {
    const contacts = await searchContacts({ email });
    const contact = contacts[0] || null;
    return { status: contact ? "linked" : "not_found", ...getCrmExclusiveFields(contact || {}, null) };
  } catch (error) {
    return { status: "unavailable", error: getSafeErrorMessage(error), syncStatus: profile?.fluentcrmSyncStatus || "not_linked" };
  }
}

async function buildOrganizationDirectoryResponse({ organizationId, actorUserId, accessMode, authUser, internalUser }) {
  const [members, profiles] = await Promise.all([listLogtoOrganizationUsers({ organizationId }), listOrganizationProfiles()]);
  const profile = profiles.find((item) => item.logtoOrganizationId === organizationId) || null;
  const directoryMembers = await Promise.all(members.map(async (member) => {
    const identity = getLogtoUserIdentityFields(member);
    const roles = identity.logtoUserId ? await listLogtoOrganizationUserRoles({ organizationId, userId: identity.logtoUserId }).catch(() => []) : [];
    const crm = await getCrmDirectoryBlock({ email: identity.email, profile });
    return {
      identity: { ...identity, roles: roles.map((role) => role.name).filter(Boolean) },
      crm,
      civitas: {
        seatAllocation: 1,
        seatConsumption: 1,
        syncStatus: profile?.fluentcrmSyncStatus || "not_linked",
        auditStatus: "ok",
        organizationMetadata: profile ? { profileId: profile.id, status: profile.status, slug: profile.slug, adminDomain: profile.adminDomain } : {},
      },
    };
  }));

  await recordAuditLogBestEffort({
    actorUserId,
    organizationId,
    action: AUDIT_ACTIONS.OWNER_ORGANIZATION_DIRECTORY_ACCESS,
    result: AUDIT_RESULTS.SUCCESS,
    metadata: { ...buildAuditContext({ authUser, internalUser, organization: { id: organizationId, name: profile?.nameCache } }), accessMode, memberCount: directoryMembers.length },
  });

  return {
    organizationId,
    sourcePolicy: {
      identity: "logto",
      organizationRoles: "logto",
      organizationMembership: "logto",
      crm: "fluentcrm_exclusive_fields_only",
      civitas: "operational_state_only",
      conflictResolution: "logto_wins_for_identity_fields",
    },
    civitas: {
      seatAllocation: profile?.seatTotal ?? 0,
      seatConsumption: directoryMembers.length,
      syncStatus: profile?.fluentcrmSyncStatus || "not_linked",
      auditStatus: "ok",
      organizationMetadata: profile ? { profileId: profile.id, status: profile.status, slug: profile.slug, adminDomain: profile.adminDomain } : {},
    },
    members: directoryMembers,
  };
}

const getSafeErrorMessage = (error) => {
  if (!error) return "Logto synchronization failed";
  const status = error.status ? ` (${error.status})` : "";
  const requestPath = error.request?.path ? ` at ${error.request.method || "GET"} ${error.request.path}` : "";
  return `${error.message || "Logto synchronization failed"}${status}${requestPath}`;
};

const buildPendingReconciliationSettings = (profile, { failedStep, error, retryRecommended = true }) => ({
  ...(profile?.settings || {}),
  pendingReconciliation: {
    failedStep,
    lastError: getSafeErrorMessage(error),
    lastAttemptAt: new Date().toISOString(),
    retryRecommended,
  },
});

async function persistPendingReconciliation({ logtoOrganizationId, profile, failedStep, error }) {
  const resolvedProfile = profile || (logtoOrganizationId ? (await listOrganizationProfiles()).find((item) => item.logtoOrganizationId === logtoOrganizationId) : null);
  if (!resolvedProfile) return null;
  return markOrganizationProfileFluentCrmSync({
    id: resolvedProfile.id,
    companyId: resolvedProfile.fluentcrmCompanyId,
    status: "error",
    errorMessage: getSafeErrorMessage(error),
    synced: false,
    settings: buildPendingReconciliationSettings(resolvedProfile, { failedStep, error }),
  });
}

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
    if (error.status === 401) return res.status(401).json({ error: "Unauthorized", message: error.message });
    if (error.status === 403) return res.status(403).json({ error: "Forbidden", message: error.message });
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
    if (error.status === 401) return res.status(401).json({ error: "Unauthorized", message: error.message });
    if (error.status === 403) return res.status(403).json({ error: "Forbidden", message: error.message });
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

app.get("/owner/operations/summary", requireAuth(API_RESOURCE), requireOwner, async (_req, res) => {
  try {
    return res.json(await loadOperationsSummary());
  } catch (error) {
    console.error("Failed to build owner operations summary", error);
    return res.status(500).json({ error: "Operations summary unavailable", message: "No se pudo cargar el resumen funcional de sincronización." });
  }
});

app.get("/owner/system/worker-health", requireAuth(API_RESOURCE), requireOwner, async (_req, res) => {
  try {
    return res.json(getWorkerHealthSnapshot());
  } catch (error) {
    console.error("Failed to load worker health snapshot", error);
    return res.status(500).json({ error: "Worker health unavailable", message: "No se pudo cargar la salud técnica del worker." });
  }
});

app.get("/owner/organization-template", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
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


app.get("/owner/integrations/wordpress/roles", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  try {
    const roles = await listWordPressRoles();
    return res.json({ roles, note: "WordPress roles are a supplemental synchronization catalog only; Logto remains canonical for Civitas authorization." });
  } catch (error) {
    console.error("Failed to load WordPress role catalog", error);
    return res.status(error.status || 502).json({ error: "WordPress roles unavailable", message: getSafeErrorMessage(error), diagnostic: error.diagnostic || null });
  }
});

app.get("/owner/integrations/wordpress/role-mappings", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  try {
    const response = await loadWordPressRoleMappingReadModel({ listRoles: listLogtoOrganizationRoles });
    return res.json(response);
  } catch (error) {
    console.error("Failed to load WordPress role mappings", error);
    return res.status(500).json({ error: "WordPress role mappings unavailable", message: "Unable to load WordPress role mappings", details: process.env.NODE_ENV === "production" ? undefined : error.message });
  }
});

app.put("/owner/integrations/wordpress/role-mappings", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  let internalUser = null;
  try {
    internalUser = await getOrCreateInternalUser(req.user);
    const mappings = Array.isArray(req.body?.mappings) ? req.body.mappings : [];
    const [logtoRolesForBefore, beforeRows, wordpressRoles] = await Promise.all([listLogtoOrganizationRoles(), db.select().from(wordpressRoleMappings), listWordPressRoles().catch(() => [])]);
    const beforeById = Object.fromEntries(beforeRows.map((row) => [row.logtoRoleId, row]));
    await upsertWordPressRoleMappings({ mappings, wordpressRoles });
    const [logtoRoles, persistedRows] = await Promise.all([listLogtoOrganizationRoles(), db.select().from(wordpressRoleMappings)]);
    const changedMappings = mappings.map((item) => ({
      logtoRoleId: item.logtoRoleId,
      organizationRoleName: item.organizationRoleName,
      before: beforeById[item.logtoRoleId]?.wordpressRoleSlug || "",
      after: item.wordpressRoleSlug || "",
    })).filter((item) => item.before !== item.after);
    await recordAuditLogBestEffort({ actorUserId: internalUser.id, action: AUDIT_ACTIONS.OWNER_WORDPRESS_ROLE_MAPPING_UPDATE, result: AUDIT_RESULTS.SUCCESS, metadata: { changedMappings, changedLogtoRoleIds: changedMappings.map((item) => item.logtoRoleId), note: "WordPress role mappings are operational sync configuration; Logto remains canonical for authorization." } });
    const response = await loadWordPressRoleMappingReadModel({ listRoles: async () => logtoRoles, listWpRoles: async () => wordpressRoles, database: { select: () => ({ from: async () => persistedRows }) } });
    return res.json(response);
  } catch (error) {
    await recordAuditLogBestEffort({ actorUserId: internalUser?.id ?? null, action: AUDIT_ACTIONS.OWNER_WORDPRESS_ROLE_MAPPING_UPDATE, result: AUDIT_RESULTS.ERROR, metadata: { error } });
    return res.status(error.status || 400).json({ error: "Bad Request", message: getSafeErrorMessage(error) });
  }
});

app.post("/owner/integrations/wordpress/role-mappings/reset", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  let internalUser = null;
  try {
    internalUser = await getOrCreateInternalUser(req.user);
    const beforeRows = await db.select().from(wordpressRoleMappings);
    await resetWordPressRoleMappings();
    const response = await loadWordPressRoleMappingReadModel({ listRoles: listLogtoOrganizationRoles });
    await recordAuditLogBestEffort({ actorUserId: internalUser.id, action: AUDIT_ACTIONS.OWNER_WORDPRESS_ROLE_MAPPING_RESET, result: AUDIT_RESULTS.SUCCESS, metadata: { clearedLogtoRoleIds: beforeRows.map((row) => row.logtoRoleId), note: "Cleared operational WordPress mappings only; Logto roles were not modified." } });
    return res.json(response);
  } catch (error) {
    await recordAuditLogBestEffort({ actorUserId: internalUser?.id ?? null, action: AUDIT_ACTIONS.OWNER_WORDPRESS_ROLE_MAPPING_RESET, result: AUDIT_RESULTS.ERROR, metadata: { error } });
    return res.status(error.status || 400).json({ error: "Bad Request", message: getSafeErrorMessage(error) });
  }
});

app.get("/owner/integrations/fluentcrm/role-mappings", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  try {
    const response = await loadCrmRoleMappingReadModel({ listRoles: listLogtoOrganizationRoles });
    return res.json(response);
  } catch (error) {
    console.error("Failed to load FluentCRM role mappings", error);
    return res.status(500).json({
      error: "Role mappings unavailable",
      message: "Unable to load FluentCRM role mappings",
      details: process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
});

app.put("/owner/integrations/fluentcrm/role-mappings", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  let internalUser = null;
  try {
    internalUser = await getOrCreateInternalUser(req.user);
    const mappings = Array.isArray(req.body?.mappings) ? req.body.mappings : [];
    const logtoRolesForBefore = await listLogtoOrganizationRoles();
    const before = await getEffectiveCrmRoleMapping({ logtoRoles: logtoRolesForBefore });
    await upsertCrmRoleMappings({ mappings });
    const [logtoRoles, persistedRows] = await Promise.all([listLogtoOrganizationRoles(), db.select().from(crmRoleMappings)]);
    const effective = await getEffectiveCrmRoleMapping({ logtoRoles });
    await recordAuditLogBestEffort({ actorUserId: internalUser.id, action: AUDIT_ACTIONS.OWNER_FLUENTCRM_ROLE_MAPPING_UPDATE, result: AUDIT_RESULTS.SUCCESS, metadata: { changedLogtoRoleIds: mappings.map((item) => item.logtoRoleId).filter(Boolean), changedRoleNames: mappings.map((item) => item.organizationRoleName).filter(Boolean), beforeSource: before.source, afterSource: effective.source } });
    return res.json(buildRoleMappingResponse({ logtoRoles, persistedRows, effective }));
  } catch (error) {
    await recordAuditLogBestEffort({ actorUserId: internalUser?.id ?? null, action: AUDIT_ACTIONS.OWNER_FLUENTCRM_ROLE_MAPPING_UPDATE, result: AUDIT_RESULTS.ERROR, metadata: { error } });
    return res.status(error.status || 400).json({ error: "Bad Request", message: getSafeErrorMessage(error) });
  }
});

app.post("/owner/integrations/fluentcrm/role-mappings/reset", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  let internalUser = null;
  try {
    internalUser = await getOrCreateInternalUser(req.user);
    await resetCrmRoleMappings();
    const [logtoRoles, persistedRows] = await Promise.all([listLogtoOrganizationRoles(), db.select().from(crmRoleMappings)]);
    const effective = await getEffectiveCrmRoleMapping({ logtoRoles });
    await recordAuditLogBestEffort({ actorUserId: internalUser.id, action: AUDIT_ACTIONS.OWNER_FLUENTCRM_ROLE_MAPPING_RESET, result: AUDIT_RESULTS.SUCCESS, metadata: { effectiveSource: effective.source } });
    return res.json(buildRoleMappingResponse({ logtoRoles, persistedRows, effective }));
  } catch (error) {
    await recordAuditLogBestEffort({ actorUserId: internalUser?.id ?? null, action: AUDIT_ACTIONS.OWNER_FLUENTCRM_ROLE_MAPPING_RESET, result: AUDIT_RESULTS.ERROR, metadata: { error } });
    return res.status(error.status || 400).json({ error: "Bad Request", message: getSafeErrorMessage(error) });
  }
});

app.get("/owner/organizations", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
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

app.post("/owner/organizations", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
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
        administrativeContactAssignments: result.administrativeContactAssignments || [],
        internalUser,
        authUser: req.user,
      });
      if (fluentCrmStep.status === "conflict") crmWarning = fluentCrmStep.message;
    } catch (crmError) {
      const crmMessage = getSafeErrorMessage(crmError);
      crmWarning = `Organization was created in Logto, but FluentCRM sync failed: ${crmMessage}`;
      const pendingProfile = await persistPendingReconciliation({ logtoOrganizationId, profile: fluentCrmStep.profile, failedStep: "fluentcrm_company_or_contacts_sync", error: crmError });
      fluentCrmStep = { status: "error", message: crmMessage, code: crmError.code || null, diagnostic: crmError.diagnostic || null, statusCode: crmError.status || null, body: crmError.body || null, profile: pendingProfile || fluentCrmStep.profile || null, pendingReconciliation: pendingProfile?.settings?.pendingReconciliation || null };
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
        administrativeContacts: { status: result.administrativeContactAssignments?.length ? "assigned" : "not_requested", contacts: result.administrativeContactAssignments || [] },
        jitProvisioning: { status: result.jitProvisioning?.status, domainConfigured: result.jitProvisioning?.domainConfigured, domain: result.jitProvisioning?.domain },
        jitDefaultRoles: { status: result.jitProvisioning?.defaultRolesConfigured ? "configured" : "not_configured", roleNames: result.jitProvisioning?.defaultRoleNames },
        fluentcrm: fluentCrmStep,
      },
      fluentcrm: fluentCrmStep,
      warning: crmWarning || undefined,
      adminAssignment: result.adminAssignment,
      administrativeContactAssignments: result.administrativeContactAssignments || [],
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
      const failedStep = error.request?.path?.includes("/jit/email-domains") ? "jit_email_domain_configuration" : error.request?.path?.includes("/jit/roles") ? "jit_default_roles_configuration" : error.request?.path?.includes("/users") ? "base_admin_user_resolution" : error.request?.path?.includes("/roles") ? "base_admin_role_assignment" : error.code === "LOGTO_ORGANIZATION_TEMPLATE_MISSING_ROLES" ? "organization_template_validation" : "base_admin_or_jit_followup";
      await persistPendingReconciliation({ logtoOrganizationId, failedStep, error }).catch(() => null);
      return res.status(201).json({
        organization: serializeLogtoOwnerOrganization(logtoOrganization, logtoOrganizationId),
        status: "created_in_logto_with_followup_failure",
        sourceOfTruth: "logto",
        warning: `Organization was created canonically in Logto, but a non-canonical follow-up step failed: ${errorMessage}`,
        failedStep,
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

app.patch("/owner/organizations/:organizationId/fluentcrm", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
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
    return res.status(status).json({ error: status === 409 ? "Conflict" : status >= 500 ? "Bad Gateway" : "Bad Request", message: getSafeErrorMessage(error), integration: "fluentcrm", code: error.code || null, diagnostic: error.diagnostic || null, fluentcrmBody: error.body || null });
  }
});

app.post(["/webhooks/fluentcrm/commercial-events", "/webhooks/wordpress/commercial-events"], async (req, res) => {
  const signature = req.get("x-civitas-signature") || req.get("x-fluentcrm-signature");
  const auth = verifyCommercialWebhookSignature({
    rawBody: req.rawBody || JSON.stringify(req.body || {}),
    signature,
    secret: process.env.COMMERCIAL_WEBHOOK_SECRET,
  });
  if (!auth.ok) {
    await recordAuditLogBestEffort({ action: AUDIT_ACTIONS.COMMERCIAL_EVENT_FAILED, result: AUDIT_RESULTS.DENIED, metadata: { stage: "webhook_authentication", reason: auth.reason } });
    return res.status(401).json({ error: "Unauthorized", message: "Invalid commercial webhook signature" });
  }

  const result = await processCommercialEvent(req.body || {});
  if (result.status === "invalid") return res.status(400).json({ error: "Bad Request", message: result.errors[0]?.message || "Invalid commercial event payload", details: result.errors });
  if (result.status === "ignored") {
    await recordAuditLogBestEffort({ action: AUDIT_ACTIONS.COMMERCIAL_EVENT_IGNORED, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "idempotency_duplicate", previousStatus: result.previousStatus } });
    return res.status(200).json({ status: "ignored", idempotent: true, previousStatus: result.previousStatus });
  }
  if (result.status === "failed") return res.status(result.code?.includes("ORG") ? 409 : 502).json({ error: "Commercial Event Failed", message: result.error || result.reason, code: result.code || result.reason || null });
  return res.status(202).json({ status: "applied", organizationId: result.organizationId, commercial: result.commercial });
});

app.get("/owner/organizations/:organizationId/commercial-status", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  const status = await getCommercialStatusForOrganization(req.params.organizationId);
  if (!status) return res.status(404).json({ error: "Not Found", message: "Organization profile not found" });
  return res.json(status);
});

app.get("/owner/organizations/:organizationId/commercial-events/latest", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  const events = await getLatestCommercialEventsForOrganization(req.params.organizationId);
  return res.json({ events });
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
    const operation = await createSyncOperation({ organizationId: req.params.organizationId, operationType: "member_identity_downstream_sync", stepName: "fluentcrm_contact_identity_sync", metadata: { logtoUserId: req.params.logtoUserId, previousEmail, email, name, phone, sourceOfTruth: "logto" } });
    await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: req.params.organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_SYNC, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "fluentcrm_contact_identity_sync_queued", logtoUserId: req.params.logtoUserId, syncOperationId: operation.id } });
    return res.json({ status: "logto_updated_sync_queued", logtoUser, syncOperation: operation, futureSelfServiceRoute: "PATCH /me/identity" });
  } catch (error) {
    return res.status(error.status || 502).json({ error: "Bad Gateway", message: getSafeErrorMessage(error), integration: "logto_management_api", logtoRequest: error.request || null, logtoErrorBody: error.body || null });
  }
});

app.patch("/owner/organizations/:organizationId/members/:logtoUserId", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  let internalUser = null;
  try {
    internalUser = await getOrCreateInternalUser(req.user);
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : null;
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : null;
    const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : null;
    const previousEmail = typeof req.body?.previousEmail === "string" ? req.body.previousEmail.trim().toLowerCase() : email;
    const logtoUser = await updateLogtoUser({ userId: req.params.logtoUserId, email, name, phone });
    const operation = await createSyncOperation({ organizationId: req.params.organizationId, operationType: "member_identity_downstream_sync", stepName: "fluentcrm_contact_identity_sync", metadata: { logtoUserId: req.params.logtoUserId, previousEmail, email, name, phone, sourceOfTruth: "logto" } });
    await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: req.params.organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "member_identity_updated", syncOperationId: operation.id } });
    return res.json({ status: "logto_updated_sync_queued", logtoUser, syncOperation: operation });
  } catch (error) {
    return res.status(error.status || 502).json({ error: "Member update failed", message: safeFunctionalMessage(getSafeErrorMessage(error), "No se pudo actualizar el miembro en Logto.") });
  }
});

app.post("/owner/organizations/:organizationId/members/:logtoUserId/reset-password", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  let internalUser = null;
  try {
    internalUser = await getOrCreateInternalUser(req.user);
    const operation = await createSyncOperation({ organizationId: req.params.organizationId, operationType: "member_reset_password", stepName: "logto_member_reset_password", metadata: { logtoUserId: req.params.logtoUserId, sourceOfTruth: "logto", policy: "provider_capability_only_no_local_reset" } });
    await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: req.params.organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "member_password_reset_queued", logtoUserId: req.params.logtoUserId, syncOperationId: operation.id } });
    return res.json({ status: "queued", provider: "logto", syncOperation: operation, message: "Reset password encolado para que el worker use solo capacidades reales de Logto; no se creará reset local." });
  } catch (error) {
    return res.status(error.status || 502).json({ error: "Password reset unavailable", message: safeFunctionalMessage(getSafeErrorMessage(error), "No se pudo iniciar el reset password en Logto.") });
  }
});

app.post("/owner/organizations/:organizationId/members/:logtoUserId/deprovision", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  let internalUser = null;
  let profile = null;
  const requestedAt = new Date().toISOString();
  try {
    internalUser = await getOrCreateInternalUser(req.user);
    profile = await resolveOrganizationProfileForRequest(req.params.organizationId);
    if (!profile?.logtoOrganizationId) return res.status(404).json({ error: "Not Found", message: "Organization profile not found or not linked to Logto" });

    await recordAuditLogBestEffort({
      actorUserId: internalUser.id,
      organizationId: profile.logtoOrganizationId,
      action: AUDIT_ACTIONS.OWNER_ORGANIZATION_MEMBER_DEPROVISION_REQUEST,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: { requestedAt, logtoUserId: req.params.logtoUserId, policy: "remove_logto_membership_then_downstream_fluentcrm_cleanup_without_global_role_mutation" },
    });

    const logtoUser = await getLogtoUserById(req.params.logtoUserId);
    const beforeMembers = await listLogtoOrganizationUsers({ organizationId: profile.logtoOrganizationId });
    const wasMember = beforeMembers.some((member) => (member.id || member.userId || member.logtoUserId || member.sub) === req.params.logtoUserId);
    if (wasMember) await removeUserFromLogtoOrganization({ organizationId: profile.logtoOrganizationId, userId: req.params.logtoUserId });

    await recordAuditLogBestEffort({
      actorUserId: internalUser.id,
      organizationId: profile.logtoOrganizationId,
      action: AUDIT_ACTIONS.OWNER_ORGANIZATION_MEMBER_DEPROVISION_LOGTO,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: { logtoUserId: req.params.logtoUserId, membership: wasMember ? "removed" : "already_absent", globalRolesMutated: false, protectedRoles: ["owner_global"] },
    });

    const allOrganizations = await listLogtoOrganizations().catch(() => []);
    const remainingMemberships = [];
    for (const organization of allOrganizations) {
      const id = getLogtoOrganizationId(organization);
      if (!id || id === profile.logtoOrganizationId) continue;
      try {
        const members = await listLogtoOrganizationUsers({ organizationId: id });
        if (members.some((member) => (member.id || member.userId || member.logtoUserId || member.sub) === req.params.logtoUserId)) remainingMemberships.push(id);
      } catch (error) {
        remainingMemberships.push(`unknown:${id}`);
      }
    }

    const identity = {
      logtoUserId: req.params.logtoUserId,
      email: logtoUser.primaryEmail || logtoUser.email || logtoUser.profile?.email || null,
      name: logtoUser.name || logtoUser.profile?.name || null,
    };
    const cleanup = await cleanupContactInFluentCrm({ identity, profile, organization: { logtoOrganizationId: profile.logtoOrganizationId, name: profile.nameCache }, remainingOrganizationIds: remainingMemberships });
    const cleanupResult = cleanup.status === "completed" ? AUDIT_RESULTS.SUCCESS : AUDIT_RESULTS.ERROR;
    await recordAuditLogBestEffort({
      actorUserId: internalUser.id,
      organizationId: profile.logtoOrganizationId,
      action: AUDIT_ACTIONS.OWNER_ORGANIZATION_MEMBER_DEPROVISION_FLUENTCRM,
      result: cleanupResult,
      metadata: { stage: "fluentcrm_member_cleanup", logtoUserId: req.params.logtoUserId, strategy: cleanup.strategy, cleanupStatus: cleanup.status, message: cleanup.message, operations: cleanup.operations, remainingOrganizationCount: remainingMemberships.length },
    });

    await markOrganizationProfileFluentCrmSync({
      id: profile.id,
      companyId: profile.fluentcrmCompanyId,
      status: cleanup.status === "completed" ? "linked" : "error",
      errorMessage: cleanup.status === "completed" ? null : cleanup.message,
      synced: cleanup.status === "completed",
      settings: {
        ...(profile.settings || {}),
        fluentcrmMemberCleanup: {
          status: cleanup.status === "completed" ? (cleanup.strategy === "no_contact_found" ? "no_crm_contact_found" : cleanup.strategy === "dissociate_only" ? "dissociated_only" : "cleanup_completed") : "cleanup_failed",
          strategy: cleanup.strategy,
          logtoUserId: req.params.logtoUserId,
          message: cleanup.message,
          updatedAt: new Date().toISOString(),
          persistencePolicy: "summary_only_no_contact_profile_replication",
        },
      },
    });

    return res.json({
      status: cleanup.status === "completed" ? "deprovisioned" : "deprovisioned_fluentcrm_failed",
      logto: { membership: wasMember ? "removed" : "already_absent", globalRolesMutated: false },
      fluentcrm: cleanup,
      audit: { requestedAt, policy: "explicit_deprovision_audited" },
    });
  } catch (error) {
    await recordAuditLogBestEffort({
      actorUserId: internalUser?.id ?? null,
      organizationId: profile?.logtoOrganizationId || req.params.organizationId,
      action: AUDIT_ACTIONS.OWNER_ORGANIZATION_MEMBER_DEPROVISION_FLUENTCRM,
      result: AUDIT_RESULTS.ERROR,
      metadata: { stage: "member_deprovision_failed", logtoUserId: req.params.logtoUserId, error },
    });
    return res.status(error.status || 502).json({ error: "Bad Gateway", message: getSafeErrorMessage(error), integration: error instanceof FluentCrmError ? "fluentcrm" : "logto_management_api", logtoRequest: error.request || null, logtoErrorBody: error.body || null });
  }
});

async function resolveOrganizationProfileForRequest(organizationId) {
  const profiles = await listOrganizationProfiles();
  return profiles.find((item) => item.id === organizationId || item.logtoOrganizationId === organizationId) || null;
}

const buildCivitasCustomData = (customData = {}, patch = {}) => {
  const existingBranding = customData.civitasProfile?.branding || {};
  const incomingBranding = { ...existingBranding, ...(patch.branding || {}) };
  const generatedBranding = buildLogtoOrganizationBrandingCss(incomingBranding);
  return {
    ...customData,
    civitasProfile: {
      version: 1,
      ...(customData.civitasProfile && typeof customData.civitasProfile === "object" ? customData.civitasProfile : {}),
      business: { ...(customData.civitasProfile?.business || {}), ...(patch.business || {}) },
      contact: { ...(customData.civitasProfile?.contact || {}), ...(patch.contact || {}) },
      branding: { ...incomingBranding, ...generatedBranding.normalized, logtoCustomCss: generatedBranding.css, customCssGeneratedAt: new Date().toISOString() },
      downstream: { ...(customData.civitasProfile?.downstream || {}), ...(patch.downstream || {}) },
      updatedAt: new Date().toISOString(),
    },
  };
};

const firstValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== "") ?? null;

async function loadFluentCrmCompanySnapshot(profile) {
  if (!profile?.fluentcrmCompanyId) return null;
  try {
    const matches = await searchCompanies({ companyId: profile.fluentcrmCompanyId });
    return matches[0]?.company || matches[0] || null;
  } catch (error) {
    console.error("Failed to load FluentCRM company snapshot for organization profile", { profileId: profile.id, companyId: profile.fluentcrmCompanyId, error });
    return { unavailable: true, message: safeFunctionalMessage(getSafeErrorMessage(error), "No se pudieron leer datos guardados en FluentCRM.") };
  }
}

function buildOrganizationProfileReadModel({ logtoOrganization, profile, fluentCrmCompany }) {
  const customData = getLogtoOrganizationCustomData(logtoOrganization);
  const provisioning = customData.provisioning || {};
  const civitasProfile = customData.civitasProfile || {};
  const business = civitasProfile.business || {};
  const contact = civitasProfile.contact || {};
  const branding = civitasProfile.branding || {};
  const crm = fluentCrmCompany && !fluentCrmCompany.unavailable ? fluentCrmCompany : {};
  return {
    sourcePriority: ["logto.customData.civitasProfile", "logto.customData.provisioning", "fluentcrm.company", "civitas.operational_cache"],
    business: {
      slug: firstValue(business.slug, provisioning.slug, profile?.slug),
      subdomain: firstValue(business.subdomain, provisioning.appSubdomain, profile?.subdomain),
      website: firstValue(business.website, crm.website, crm.url),
      institutionalDomain: firstValue(business.institutionalDomain, provisioning.institutionalDomain, profile?.adminDomain),
      nit: firstValue(business.nit, crm.nit, crm.custom_values?.nit),
      verificationDigit: firstValue(business.verificationDigit, crm.verification_digit, crm.custom_values?.verification_digit),
      country: firstValue(business.country, crm.country),
      department: firstValue(business.department, crm.state, crm.region),
      city: firstValue(business.city, crm.city),
      postalCode: firstValue(business.postalCode, crm.postal_code, crm.zip),
      addressLine1: firstValue(business.addressLine1, crm.address_line_1, crm.address1, crm.address),
      addressLine2: firstValue(business.addressLine2, crm.address_line_2, crm.address2),
    },
    contact: {
      owner: firstValue(contact.owner, crm.company_owner, crm.owner),
      email: firstValue(contact.email, crm.email),
      phone: firstValue(contact.phone, crm.phone),
    },
    branding,
    crm: { companyId: profile?.fluentcrmCompanyId || null, company: fluentCrmCompany },
  };
}

app.get("/owner/organizations/:organizationId/profile", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  try {
    const profile = await resolveOrganizationProfileForRequest(req.params.organizationId);
    const logtoOrganizationId = profile?.logtoOrganizationId || req.params.organizationId;
    const [logtoOrganization, fluentCrmCompany, pending, events] = await Promise.all([
      getLogtoOrganizationById(logtoOrganizationId),
      loadFluentCrmCompanySnapshot(profile),
      listOrganizationPendingSync({ organizationId: logtoOrganizationId }).catch((error) => {
        console.error("Failed to load pending sync operations", error);
        return [];
      }),
      listOrganizationEvents({ organizationId: logtoOrganizationId }).catch(() => []),
    ]);
    return res.json({
      organization: serializeOwnerOrganization(profile, logtoOrganization),
      canonical: { source: "logto", topLevelFields: ["id", "name", "description"], customData: getLogtoOrganizationCustomData(logtoOrganization) },
      readModel: buildOrganizationProfileReadModel({ logtoOrganization, profile, fluentCrmCompany }),
      customDataShape: { root: "customData.civitasProfile", sections: ["business", "contact", "branding", "downstream"] },
      downstreamOnly: ["fluentcrmCompanyId", "fluentcrmSyncStatus", "fluentcrmContactSync"],
      sync: { pending, events },
    });
  } catch (error) {
    console.error("Failed to load owner organization profile", error);
    return res.status(error.status || 502).json({ error: "Organization profile unavailable", message: "No se pudo cargar el perfil de la organización. Intenta de nuevo más tarde." });
  }
});

app.patch("/owner/organizations/:organizationId/profile", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  let internalUser = null;
  try {
    internalUser = await getOrCreateInternalUser(req.user);
    const profile = await resolveOrganizationProfileForRequest(req.params.organizationId);
    const logtoOrganizationId = profile?.logtoOrganizationId || req.params.organizationId;
    const current = await getLogtoOrganizationById(logtoOrganizationId);
    const customData = buildCivitasCustomData(getLogtoOrganizationCustomData(current), req.body?.customData || {});
    const updated = await updateLogtoOrganization({ organizationId: logtoOrganizationId, name: req.body?.name || getLogtoOrganizationName(current), description: req.body?.description || current.description, customData });
    if (profile) {
      await db.update(organizationProfiles).set({
        nameCache: getLogtoOrganizationName(updated) || profile.nameCache,
        slug: customData.civitasProfile?.business?.slug || profile.slug,
        adminDomain: customData.civitasProfile?.business?.institutionalDomain || profile.adminDomain,
        logoUrl: customData.civitasProfile?.branding?.logoUrl || profile.logoUrl,
        primaryColor: customData.civitasProfile?.branding?.primaryColor || profile.primaryColor,
        updatedAt: new Date(),
      }).where(eq(organizationProfiles.id, profile.id));
    }
    const operation = await createSyncOperation({ organizationId: logtoOrganizationId, operationType: "organization_profile_downstream_sync", stepName: "fluentcrm_company_profile_sync", metadata: { source: "logto_customData.civitasProfile", target: "fluentcrm", requestedBy: "owner_console" } });
    await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "organization_profile_custom_data_updated", syncOperationId: operation.id, sourceOfTruth: "logto.customData" } });
    return res.json({ status: "updated_sync_queued", organization: serializeOwnerOrganization(profile, updated), syncOperation: operation });
  } catch (error) {
    await recordAuditLogBestEffort({ actorUserId: internalUser?.id ?? null, organizationId: req.params.organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.ERROR, metadata: { stage: "organization_profile_custom_data_update_failed", error } });
    return res.status(error.status || 502).json({ error: "Profile update failed", message: safeFunctionalMessage(getSafeErrorMessage(error), "No se pudo guardar el perfil en Logto.") });
  }
});

app.get("/owner/organizations/:organizationId/pending-sync", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  const profile = await resolveOrganizationProfileForRequest(req.params.organizationId);
  const organizationId = profile?.logtoOrganizationId || req.params.organizationId;
  return res.json({ organizationId, pending: await listOrganizationPendingSync({ organizationId }) });
});

app.get("/owner/organizations/:organizationId/events", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  const profile = await resolveOrganizationProfileForRequest(req.params.organizationId);
  const organizationId = profile?.logtoOrganizationId || req.params.organizationId;
  return res.json({ organizationId, events: await listOrganizationEvents({ organizationId }) });
});

app.post("/owner/organizations/:organizationId/sync-operations/:operationId/retry", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  const profile = await resolveOrganizationProfileForRequest(req.params.organizationId);
  const organizationId = profile?.logtoOrganizationId || req.params.organizationId;
  const operation = await retrySyncOperation({ operationId: req.params.operationId, organizationId });
  await recordAuditLogBestEffort({ organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "sync_operation_retry_requested", operationId: req.params.operationId } });
  return res.json({ status: "retry_queued", operation });
});

const buildContactSyncSettings = (profile, summary) => ({
  ...(profile.settings || {}),
  fluentcrmContactSync: {
    status: summary.status,
    total: summary.total,
    succeeded: summary.succeeded,
    failed: summary.failed,
    conflicts: summary.conflicts,
    errors: summary.errors,
    syncedAt: new Date().toISOString(),
    persistencePolicy: "summary_only_no_contact_profile_replication",
  },
});

app.post("/owner/organizations/:organizationId/fluentcrm/sync-contacts", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  let internalUser = null;
  try {
    internalUser = await getOrCreateInternalUser(req.user);
    const profile = await resolveOrganizationProfileForRequest(req.params.organizationId);
    if (!profile) return res.status(404).json({ error: "Not Found", message: "Organization profile not found" });
    const members = await listLogtoOrganizationUsers({ organizationId: profile.logtoOrganizationId });
    const logtoRoles = await listLogtoOrganizationRoles();
    const roleMapping = (await getEffectiveCrmRoleMapping({ logtoRoles })).mapping;
    const summary = await syncOrganizationContactsToFluentCrm({
      profile,
      roleMapping,
      members,
      getMemberRoles: async (logtoUserId) => (await listLogtoOrganizationUserRoles({ organizationId: profile.logtoOrganizationId, userId: logtoUserId })).map((role) => ({ logtoRoleId: role.id || role.organizationRoleId || role.roleId, organizationRoleName: role.name || role.nameCache || role.key })).filter((role) => role.logtoRoleId || role.organizationRoleName),
      audit: async (event) => recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: profile.logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_CONTACT_SYNC, result: event.result === "success" ? AUDIT_RESULTS.SUCCESS : AUDIT_RESULTS.ERROR, metadata: { stage: "fluentcrm_contact_sync", ...event } }),
      markOrganizationSync: async (summaryToPersist) => markOrganizationProfileFluentCrmSync({ id: profile.id, companyId: profile.fluentcrmCompanyId, status: summaryToPersist.status === "synced" ? "linked" : summaryToPersist.status === "conflict" ? "conflict" : "error", errorMessage: summaryToPersist.errors?.[0]?.reason || null, synced: summaryToPersist.status === "synced", settings: buildContactSyncSettings(profile, summaryToPersist) }),
    });
    return res.json({ organizationId: profile.logtoOrganizationId, fluentcrmCompanyId: profile.fluentcrmCompanyId, contactSync: summary });
  } catch (error) {
    await recordAuditLogBestEffort({ actorUserId: internalUser?.id ?? null, organizationId: req.params.organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_CONTACT_SYNC, result: AUDIT_RESULTS.ERROR, metadata: { stage: "fluentcrm_contact_sync_failed", error } });
    return res.status(error.status || 502).json({ error: "Bad Gateway", message: getSafeErrorMessage(error), integration: "fluentcrm" });
  }
});

app.get("/owner/organizations/:organizationId/fluentcrm/sync-status", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  const profile = await resolveOrganizationProfileForRequest(req.params.organizationId);
  if (!profile) return res.status(404).json({ error: "Not Found", message: "Organization profile not found" });
  return res.json({ organizationId: profile.logtoOrganizationId, companyId: profile.fluentcrmCompanyId, syncStatus: profile.fluentcrmSyncStatus, syncError: profile.fluentcrmSyncError, syncedAt: profile.fluentcrmSyncedAt, contactSync: profile.settings?.fluentcrmContactSync || null, persistencePolicy: "summary_only_no_contact_profile_replication" });
});

app.get("/owner/integrations/fluentcrm/health", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  try {
    return res.json({ integration: "fluentcrm", ...(await validateFluentCrmConfiguration()) });
  } catch (error) {
    const status = error.status || (error.code === "FLUENTCRM_CONFIG_MISSING" || error.code === "FLUENTCRM_CONFIG_INVALID" ? 400 : 502);
    return res.status(status).json({ integration: "fluentcrm", status: "error", message: getSafeErrorMessage(error), code: error.code || null, diagnostic: error.diagnostic || null, details: error.body || null });
  }
});

app.get("/owner/organizations/:organizationId/directory", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  try {
    const internalUser = await getOrCreateInternalUser(req.user);
    const result = await buildOrganizationDirectoryResponse({ organizationId: req.params.organizationId, actorUserId: internalUser.id, accessMode: "owner_global", authUser: req.user, internalUser });
    return res.json(result);
  } catch (error) {
    console.error("Failed to build owner organization directory", error);
    return res.status(error.status || 502).json({ error: "Bad Gateway", message: getSafeErrorMessage(error), sourcePolicy: "logto_first_directory" });
  }
});

app.get("/organizations/:organizationId/directory", requireOrganizationAccess({ requiredScopes: ["organizations:read"], requiredRoleName: ORGANIZATION_ADMIN_ROLE_NAME }), async (req, res) => {
  try {
    const internalUser = await getOrCreateInternalUser(req.user);
    const result = await buildOrganizationDirectoryResponse({ organizationId: req.params.organizationId, actorUserId: internalUser.id, accessMode: "organization_admin", authUser: req.user, internalUser });
    return res.json(result);
  } catch (error) {
    console.error("Failed to build organization directory", error);
    return res.status(error.status || 502).json({ error: "Bad Gateway", message: getSafeErrorMessage(error), sourcePolicy: "logto_first_directory" });
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
    if (error.status === 401) return res.status(401).json({ error: "Unauthorized", message: error.message });
    if (error.status === 403) return res.status(403).json({ error: "Forbidden", message: error.message });
    console.error("Failed to list audit logs", error);
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to list audit logs" });
  }
});

app.get("/organizations/:organizationId/documents", requireOrganizationAccess({ requiredScopes: ["documents:read"] }), async (req, res) => {
  return res.json({
    organizationId: req.user.organizationId,
    documents: [],
    source: "organization_token",
  });
});

app.post("/organizations/:organizationId/documents", requireOrganizationAccess({ requiredScopes: ["documents:create"] }), async (req, res) => {
  return res.status(201).json({
    organizationId: req.user.organizationId,
    document: null,
    source: "organization_token",
    message: "Organization-scoped document creation placeholder",
  });
});

app.get("/", (req, res) => {
  res.json({ message: "Welcome to the Civitas API", health: "/health" });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
