const express = require("express");
const cors = require("cors");
const { eq } = require("drizzle-orm");
require("dotenv").config();
const { requireAuth, requireOrganizationAccess, requireScope } = require("./middleware/auth");
const { buildOwnerCapabilities, requireOwner } = require("./middleware/owner");
const { buildAuthorizationMetadata } = require("./services/authorizationMetadata");
const { checkDatabaseConnection } = require("./db/connection");
const { getIdentityFromLogtoClaims, getOrCreateInternalUser, resolveInternalUserForSession, serializeUser } = require("./services/users");
const {
  ORGANIZATION_ADMIN_ROLE_NAME,
  ensureOrganizationTemplate,
  getLogtoUserById,
  getLogtoOrganizationById,
  removeUserFromLogtoOrganization,
  updateLogtoOrganization,
  updateLogtoUser,
  listLogtoOrganizationRoles,
  findOrganizationRoleByName,
  createOrResolveLogtoUserByEmail,
  addUserToLogtoOrganization,
  assignOrganizationRoleToUser,
  listLogtoOrganizationUserRoles,
  listLogtoOrganizationUsers,
  listLogtoOrganizations,
} = require("./services/logtoManagement");
const {
  LOGTO_SYNC_STATUSES,
  listOrganizationProfiles,
  deleteOrganizationProfilesByIds,
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
const { buildLogtoUsername, normalizeCanonicalProvisioningInput, runCanonicalOrganizationBootstrap } = require("./services/organizationProvisioningCore");
const { buildLogtoUserCreatePayload } = require("./services/organizationProvisioningPayloads");
const { APP_BASE_DOMAINS, buildEntryUrl, buildLogtoOrganizationCustomData, normalizeExtendedProvisioningInput } = require("./services/organizationProvisioningSettings");
const {
  FluentCrmError,
  cleanupContactInFluentCrm,
  ensureOrganizationTagsAndLists,
  getOrCreateCompanyForOrganization,
  normalizeCrmCompanyInput,
  searchCompanies,
  searchContacts,
  syncOrganizationContactsToFluentCrm,
  validateFluentCrmConfiguration,
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
const { crmRoleMappings, organizationProfiles, syncOperations, wordpressRoleMappings } = require("./db/schema");
const { getCommercialStatusForOrganization, getLatestCommercialEventsForOrganization, processCommercialEvent, verifyCommercialWebhookSignature } = require("./services/commercialEvents");
const { getWorkerHealthSnapshot, loadOperationsSummary, loadOwnerSystemMetrics, loadWorkerQueuesObservability } = require("./services/operationalObservability");
const { buildConsolidatedOperationalResponse } = require("./services/operationalStateAssembler");
const {
  createSyncOperation,
  listOrganizationEvents,
  listOperationalLogs,
  listOrganizationPendingSync,
  retrySyncOperation,
  resendSyncOperationPayload,
  manualResolveSyncOperation,
  verifySyncOperationProvider,
  recordOperationStep,
  updateSyncOperation,
  safeFunctionalMessage,
  getLatestOperationForOrganization,
  getSyncOperationWithSteps,
} = require("./services/syncOperations");
const { buildLogtoOrganizationBrandingCss } = require("./services/brandingCss");
const {
  BOOTSTRAP_OPERATION_STATUSES,
  buildMicroRequestsForFluentCrmStep,
  createBootstrapOperation,
  insertMicroRequests,
  listOpenMicroRequests,
  markMicroRequestForRetry,
  updateBootstrapOperation,
} = require("./services/organizationBootstrapOperations");
const { enqueueOrganizationBootstrap } = require("./services/organizationBootstrapOrchestrator");
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


const getLogtoOrganizationCustomData = (organization = {}) => {
  const customData = organization.customData || organization.custom_data || {};
  return customData && typeof customData === "object" && !Array.isArray(customData) ? customData : {};
};

const deriveAppEntryFromOidcRedirectUri = (oidcRedirectUri) => {
  if (!oidcRedirectUri || typeof oidcRedirectUri !== "string") return { appSubdomain: null, appBaseDomain: null, entryUrl: null, inconsistency: "missing_oidc_redirect_uri" };
  try {
    const url = new URL(oidcRedirectUri);
    const hostname = url.hostname.toLowerCase();
    const appBaseDomain = APP_BASE_DOMAINS.find((domain) => hostname.endsWith(`.${domain}`)) || null;
    if (!appBaseDomain) return { appSubdomain: null, appBaseDomain: null, entryUrl: null, inconsistency: "unsupported_oidc_redirect_domain" };
    const suffix = `.${appBaseDomain}`;
    const appSubdomain = hostname.slice(0, -suffix.length);
    if (!appSubdomain || appSubdomain.includes(".")) return { appSubdomain: null, appBaseDomain, entryUrl: null, inconsistency: "invalid_oidc_redirect_subdomain" };
    return { appSubdomain, appBaseDomain, entryUrl: buildEntryUrl(appSubdomain, appBaseDomain), inconsistency: null };
  } catch (error) {
    return { appSubdomain: null, appBaseDomain: null, entryUrl: null, inconsistency: "invalid_oidc_redirect_uri" };
  }
};

const buildCanonicalLogtoOrganizationFields = (logtoOrganization = {}) => {
  const customData = getLogtoOrganizationCustomData(logtoOrganization);
  const provisioning = customData.provisioning && typeof customData.provisioning === "object" ? customData.provisioning : {};
  const oidcRedirectUri = typeof customData.oidcRedirectUri === "string" ? customData.oidcRedirectUri : null;
  const derivedEntry = deriveAppEntryFromOidcRedirectUri(oidcRedirectUri);
  const appSubdomain = typeof provisioning.appSubdomain === "string" && provisioning.appSubdomain ? provisioning.appSubdomain : derivedEntry.appSubdomain;
  const appBaseDomain = typeof provisioning.appBaseDomain === "string" && APP_BASE_DOMAINS.includes(provisioning.appBaseDomain) ? provisioning.appBaseDomain : derivedEntry.appBaseDomain;
  const entryUrl = appSubdomain && appBaseDomain ? buildEntryUrl(appSubdomain, appBaseDomain) : null;

  return {
    name: getCanonicalLogtoOrganizationName(logtoOrganization),
    customData,
    oidcRedirectUri,
    appSubdomain,
    appBaseDomain,
    entryUrl,
    entryUrlInconsistency: entryUrl ? null : derivedEntry.inconsistency || "missing_app_entry_fields",
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


const STATUS_COMPONENT_LABELS = Object.freeze({ logto: "Logto", branding: "Branding", users: "FluentCRM contact", crm: "FluentCRM company", retry: "Retry", human: "Acción humana", downstream: "Downstream" });
const FAILURE_STATUSES = new Set(["error", "failed", "partial_failed", "conflict", "unavailable"]);
const PENDING_STATUSES = new Set(["pending", "queued", "running", "partial_error", "not_linked", "metadata_missing", "creator_membership_pending", "creator_role_pending", "logto_created"]);
const OK_LOGTO_STATUSES = new Set(["bootstrapped", "synced", "reconciled", "completed"]);
const OK_CRM_STATUSES = new Set(["linked", "synced", "completed"]);

const getOperationalComponentState = (status, okStatuses = new Set()) => {
  if (!status || okStatuses.has(status)) return null;
  if (FAILURE_STATUSES.has(status)) return "failure";
  if (PENDING_STATUSES.has(status)) return "pending";
  return null;
};

const pushOperationalComponent = (components, key, state, detail = null) => {
  if (!state || components.some((component) => component.key === key && component.state === state)) return;
  components.push({ key, label: STATUS_COMPONENT_LABELS[key] || key, state, detail });
};

const summarizeOperationalProjection = ({ profile = null, hasConflict = false, pending = [] } = {}) => {
  const base = profile?.status === "suspended" ? "Suspendida" : "Activa";
  const components = [];
  const add = (key, state, detail = null, extra = {}) => pushOperationalComponent(components, key, state, detail || null) || Object.assign(components[components.length - 1] || {}, extra);
  const hasProjection = Boolean(profile || pending.length || hasConflict);

  if (!hasProjection) return { base, baseStatus: base, summary: "estado operativo no proyectado", text: `${base} · estado operativo no proyectado`, components: [], primaryIssue: null, retryState: null, requiresHumanAction: false, source: "none", sourceLabel: "Estado operativo reconciliado localmente", verificationLevel: "not_projected", providerVerification: "not_live_verified", providerVerificationLabel: "No verificado en vivo contra FluentCRM/WordPress", derivedFromOperationIds: [], projected: false };
  if (hasConflict) add("human", "failure", "duplicate_profiles");

  for (const item of pending) {
    if (item.operationType === "provider_verification") continue;
    const key = item.entityType?.includes("contact") ? "users" : item.entityType?.includes("company") ? "crm" : item.entityType?.includes("branding") ? "branding" : item.retryState ? "retry" : "downstream";
    if (item.requiresHumanAction) add("human", "failure", item.humanMessage || item.suggestedAction || item.stepName);
    if (["failed", "partial_failed", "error", "conflict"].includes(item.status)) add(key, "failure", item.humanMessage || item.lastError || item.stepName);
    if (["queued", "running", "failed_again", "requested", "retry_requested", "retry_enqueued"].includes(item.retryState || "")) add("retry", "pending", item.retryState);
    if (!["completed", "succeeded"].includes(item.status) && !["failed", "partial_failed", "error", "conflict"].includes(item.status)) add(key, "pending", item.humanMessage || item.stepName);
  }

  if (profile) {
    const settings = profile.settings && typeof profile.settings === "object" ? profile.settings : {};
    if (getOperationalComponentState(profile.logtoSyncStatus, OK_LOGTO_STATUSES)) add("logto", getOperationalComponentState(profile.logtoSyncStatus, OK_LOGTO_STATUSES), profile.logtoSyncError || profile.logtoSyncStatus);
    if (!pending.some((item) => item.entityType === "fluentcrm.company") && getOperationalComponentState(profile.fluentcrmSyncStatus, OK_CRM_STATUSES)) add("crm", getOperationalComponentState(profile.fluentcrmSyncStatus, OK_CRM_STATUSES), profile.fluentcrmSyncError || profile.fluentcrmSyncStatus);
    const brandingStatus = settings.brandingSyncStatus || settings.branding?.syncStatus || settings.logtoCustomCssSyncStatus;
    if (getOperationalComponentState(brandingStatus, new Set(["synced", "completed", "generated"]))) add("branding", getOperationalComponentState(brandingStatus, new Set(["synced", "completed", "generated"])), settings.brandingSyncError || brandingStatus);
    const contactStatus = settings.fluentcrmContactSync?.status || settings.contactSyncStatus || settings.usersSyncStatus;
    if (getOperationalComponentState(contactStatus, new Set(["synced", "completed"]))) add("users", getOperationalComponentState(contactStatus, new Set(["synced", "completed"])), settings.fluentcrmContactSync?.reason || settings.contactSyncError || settings.usersSyncError || contactStatus);
  }

  const priority = [
    () => components.find((component) => component.key === "human"),
    () => components.find((component) => component.state === "failure" && ["crm", "users", "branding", "downstream"].includes(component.key)),
    () => components.find((component) => component.key === "retry"),
    () => components.find((component) => component.key === "crm" && component.state === "pending"),
    () => components.find((component) => component.key === "users" && component.state === "pending"),
    () => components.find((component) => component.key === "branding" && component.state === "pending"),
  ];
  const selected = priority.map((pick) => pick()).find(Boolean);
  const summary = selected ? selected.key === "human" ? "requiere acción humana" : selected.key === "retry" ? `retry ${selected.detail || "pendiente"}` : `${selected.state === "failure" ? "falla" : "pendiente"} ${selected.label}` : "ok";
  const providerVerificationItem = pending.find((item) => item.operationType === "provider_verification");
  const providerStatus = providerVerificationItem?.providerStatus || providerVerificationItem?.metadata?.providerStatus || null;
  const providerRetryState = providerVerificationItem?.retryState || null;
  const providerVerification = providerVerificationItem
    ? providerVerificationItem.status === "completed"
      ? providerStatus === "all_ok"
        ? "all_ok"
        : providerStatus || "live_completed"
      : providerRetryState === "running"
        ? "live_running"
        : providerRetryState === "queued"
          ? "live_queued"
          : providerStatus || providerRetryState || "live_requires_attention"
    : "not_live_verified";
  const providerLabels = {
    not_live_verified: "No verificado en vivo contra FluentCRM/WordPress; deriva de perfiles, operaciones, steps y pendientes proyectados en Civitas.",
    live_queued: "Verificación live en cola",
    live_running: "Verificación live ejecutándose",
    all_ok: "Verificado en vivo: OK",
    missing_fluentcrm_company: "Verificado en vivo: falta Company en FluentCRM",
    missing_fluentcrm_contact: "Verificado en vivo: faltan contactos",
    awaiting_first_wordpress_login: "Verificado en vivo: falta usuario WordPress; esperando primer login",
    missing_contact_wp_link: "Verificado en vivo: requiere acción humana por enlace Contact/WordPress",
    provider_auth_error: "Verificación live falló por proveedor",
    provider_timeout: "Verificación live falló por proveedor",
  };
  return {
    base,
    baseStatus: base,
    summary,
    text: `${base} · ${summary}`,
    components,
    primaryIssue: selected || null,
    retryState: components.find((component) => component.key === "retry")?.detail || null,
    requiresHumanAction: components.some((component) => component.key === "human"),
    source: providerVerificationItem?.status === "completed" ? "live_provider_check" : "organization_profile+sync_operations+sync_operation_steps+projected_crm_pending",
    sourceLabel: providerVerificationItem?.status === "completed" ? "Verificación live contra proveedores" : "Estado operativo reconciliado localmente",
    verificationLevel: providerVerificationItem?.status === "completed" ? "live_provider_check" : "local_reconciled",
    providerVerification,
    providerVerificationLabel: providerLabels[providerVerification] || providerVerificationItem?.humanMessage || "Verificado en vivo: requiere acción humana",
    derivedFromOperationIds: [...new Set(pending.map((item) => item.operationId).filter(Boolean))],
    projected: true,
  };
};

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

async function buildDirectoryOperationalStatus({ profile = null, hasConflict = false, logtoOrganizationId = null } = {}) {
  const organizationId = profile?.logtoOrganizationId || logtoOrganizationId;
  const pending = organizationId ? await listOrganizationPendingSync({ organizationId }).catch((error) => {
    console.error("Failed to project organization operational status", { organizationId, error });
    return [];
  }) : [];
  return summarizeOperationalProjection({ profile, hasConflict, pending });
}

async function buildLogtoOrganizationDirectory({ logtoOrganizations, profiles }) {
  const logtoOrganizationIds = new Set(logtoOrganizations.map(getLogtoOrganizationId).filter(Boolean));
  const profilesByLogtoId = new Map();
  const profilesWithoutLogtoId = [];
  for (const profile of profiles) {
    if (profile.logtoOrganizationId) {
      if (logtoOrganizationIds.has(profile.logtoOrganizationId)) {
        const existingProfiles = profilesByLogtoId.get(profile.logtoOrganizationId) || [];
        existingProfiles.push(profile);
        profilesByLogtoId.set(profile.logtoOrganizationId, existingProfiles);
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
  const organizations = (await Promise.all(logtoOrganizations
    .map(async (logtoOrganization) => {
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
        operationalStatus: await buildDirectoryOperationalStatus({ profile, hasConflict, logtoOrganizationId }),
        reconciliation: {
          status: reconciliationStatus,
          profileCount: associatedProfiles.length,
          matchedBy: linkedProfiles.length > 0 ? "logto_organization_id" : nameMatchedLegacyProfiles.length > 0 ? "name" : null,
          profileIds: associatedProfiles.map((associatedProfile) => associatedProfile.id),
          canonicalProfileId: profile?.id || null,
          duplicateProfileIds,
        },
      };
    })))
    .filter(Boolean);

  return {
    organizations,
    reconciliationIncidents: [],
    unreconciledProfiles: [],
  };
}

async function cleanupOrphanedOrganizationProfiles({ logtoOrganizations = [], profiles = [] } = {}) {
  const logtoOrganizationIds = new Set(logtoOrganizations.map(getLogtoOrganizationId).filter(Boolean));
  const orphanedProfileIds = profiles
    .filter((profile) => profile.logtoOrganizationId && !logtoOrganizationIds.has(profile.logtoOrganizationId))
    .map((profile) => profile.id);
  if (orphanedProfileIds.length === 0) return { deletedProfiles: [], deletedProfileIds: [] };
  const deletedProfiles = await deleteOrganizationProfilesByIds(orphanedProfileIds);
  return { deletedProfiles, deletedProfileIds: deletedProfiles.map((profile) => profile.id) };
}

function reconcileProfilesWithLogtoOrganizations({ logtoOrganizations = [], profiles = [] }) {
  const logtoOrganizationIds = new Set(logtoOrganizations.map(getLogtoOrganizationId).filter(Boolean));
  return profiles.filter((profile) => !profile.logtoOrganizationId || logtoOrganizationIds.has(profile.logtoOrganizationId));
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
  const contactSyncSummary = {
    status: "queued",
    reason: "post_company_member_sync_scheduled",
    persistencePolicy: "summary_only_no_contact_profile_replication",
  };
  setImmediate(() => {
    runOrganizationContactSyncAfterCompany({
      profile,
      companyId,
      logtoOrganizationId,
      internalUser,
    }).catch((error) => {
      console.error("FluentCRM post-company contact sync failed", { logtoOrganizationId, error });
    });
  });

  // Administrative contacts are still reported for provisioning visibility. The
  // actual contact writes happen in the scheduled Logto member sync above, so the
  // API response can finish without waiting for every downstream contact request.
  const administrativeContacts = [];

  for (const assignment of administrativeContactAssignments) {
    const contactSync = { status: "queued", reason: "covered_by_post_company_member_sync" };
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
    contactSync: contactSyncSummary,
    administrativeContacts,
  };
}

async function runOrganizationContactSyncAfterCompany({ profile, companyId, logtoOrganizationId, internalUser }) {
  const profileForContactSync = { ...profile, fluentcrmCompanyId: companyId };
  try {
    await markOrganizationProfileFluentCrmSync({
      id: profile.id,
      companyId,
      status: "linked",
      errorMessage: null,
      synced: false,
      settings: buildContactSyncSettings(profile, {
        status: "queued",
        total: 0,
        succeeded: 0,
        failed: 0,
        conflicts: 0,
        errors: [],
      }),
    });
    const members = await listLogtoOrganizationUsers({ organizationId: logtoOrganizationId });
    const logtoRoles = await listLogtoOrganizationRoles();
    const roleMapping = (await getEffectiveCrmRoleMapping({ logtoRoles })).mapping;
    return syncOrganizationContactsToFluentCrm({
      profile: profileForContactSync,
      members,
      roleMapping,
      getMemberRoles: async (logtoUserId) => (await listLogtoOrganizationUserRoles({ organizationId: logtoOrganizationId, userId: logtoUserId }))
        .map((role) => role.name || role.nameCache || role.key || role.organizationRoleName)
        .filter(Boolean),
      audit: async (event) => recordAuditLogBestEffort({
        actorUserId: internalUser.id,
        organizationId: logtoOrganizationId,
        action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_CONTACT_SYNC,
        result: event.result === "success" ? AUDIT_RESULTS.SUCCESS : AUDIT_RESULTS.ERROR,
        metadata: { stage: "fluentcrm_contact_sync_after_company", ...event },
      }),
      markOrganizationSync: async (summaryToPersist) => markOrganizationProfileFluentCrmSync({
        id: profile.id,
        companyId,
        status: summaryToPersist.status === "synced" ? "linked" : summaryToPersist.status === "conflict" ? "conflict" : "error",
        errorMessage: summaryToPersist.errors?.[0]?.reason || null,
        synced: summaryToPersist.status === "synced",
        settings: buildContactSyncSettings(profile, summaryToPersist),
      }),
    });
  } catch (error) {
    const summary = {
      status: "partial_error",
      total: 0,
      succeeded: 0,
      failed: 0,
      conflicts: 0,
      errors: [{ reason: error.code || "post_company_contact_sync_failed", message: getSafeErrorMessage(error), status: error.status || null }],
    };
    await markOrganizationProfileFluentCrmSync({
      id: profile.id,
      companyId,
      status: "error",
      errorMessage: summary.errors[0].reason,
      synced: false,
      settings: buildContactSyncSettings(profile, summary),
    });
    await recordAuditLogBestEffort({
      actorUserId: internalUser.id,
      organizationId: logtoOrganizationId,
      action: AUDIT_ACTIONS.OWNER_ORGANIZATION_FLUENTCRM_CONTACT_SYNC,
      result: AUDIT_RESULTS.ERROR,
      metadata: { stage: "fluentcrm_contact_sync_after_company_failed", summary },
    });
    return summary;
  }
}

const getColombianNameFields = (user = {}) => {
  const legacy = user.customData?.civitasProfile || user.customData?.civitas || user.profile?.civitas || {};
  const primerNombre = user.profile?.givenName ?? legacy.primerNombre ?? null;
  const segundoNombre = user.profile?.middleName ?? legacy.segundoNombre ?? null;
  const primerApellido = user.profile?.familyName ?? legacy.primerApellido ?? null;
  const segundoApellido = user.customData?.secondFamilyName ?? legacy.segundoApellido ?? null;
  const derivedName = [primerNombre, segundoNombre, primerApellido, segundoApellido].filter(Boolean).join(" ") || null;
  return { primerNombre, segundoNombre, primerApellido, segundoApellido, derivedName };
};

const getLogtoUserIdentityFields = (user = {}) => {
  const names = getColombianNameFields(user);
  return {
    logtoUserId: user.id || user.userId || user.logtoUserId || user.sub || null,
    primerNombre: names.primerNombre,
    segundoNombre: names.segundoNombre,
    primerApellido: names.primerApellido,
    segundoApellido: names.segundoApellido,
    name: names.derivedName || user.name || user.profile?.name || null,
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
    lastLoginAt: user.lastSignInAt || user.lastLoginAt || null,
    sessions: { availability: "not_loaded", note: "Logto session details require provider-specific session endpoints; Civitas does not mirror sessions locally." },
    spentTime: { availability: "not_available", value: null, note: "No reliable Logto v1.40.1 aggregate spent-time signal is persisted in Civitas." },
  };
};

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

function memberMatchesDirectoryQuery(member, query = {}) {
  const identity = member.identity || {};
  const q = String(query.q || "").trim().toLowerCase();
  const roles = identity.roles || [];
  const text = [identity.primerNombre, identity.segundoNombre, identity.primerApellido, identity.segundoApellido, identity.name, identity.email, identity.phone, identity.logtoUserId, ...roles].filter(Boolean).join(" ").toLowerCase();
  if (q && !text.includes(q)) return false;
  if (query.role && !roles.includes(String(query.role))) return false;
  if (query.status && String(query.status) !== "all" && String(member.civitas?.membershipStatus || "active") !== String(query.status)) return false;
  if (query.mfa === "enabled" && identity.mfa?.enabled !== true) return false;
  if (query.mfa === "disabled" && identity.mfa?.enabled !== false) return false;
  if (query.origin && String(query.origin) !== "all" && !String(member.civitas?.origin || "Logto").toLowerCase().includes(String(query.origin).toLowerCase())) return false;
  if (query.lastLogin) {
    const now = Date.now();
    const last = identity.lastLoginAt ? new Date(identity.lastLoginAt).getTime() : null;
    if (query.lastLogin === "never" && last) return false;
    if (query.lastLogin === "7d" && (!last || now - last > 7 * 86400000)) return false;
    if (query.lastLogin === "30d" && (!last || now - last > 30 * 86400000)) return false;
    if (query.lastLogin === "gt30d" && (!last || now - last <= 30 * 86400000)) return false;
  }
  return true;
}

async function buildOrganizationDirectoryResponse({ organizationId, actorUserId, accessMode, authUser, internalUser, query = {} }) {
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
        membershipStatus: "active",
        origin: "Logto",
        organizationMetadata: profile ? { profileId: profile.id, status: profile.status, slug: profile.slug, adminDomain: profile.adminDomain } : {},
      },
    };
  }));

  const filteredMembers = directoryMembers.filter((member) => memberMatchesDirectoryQuery(member, query));
  const limit = Number.isFinite(Number(query.limit)) ? Math.max(0, Number(query.limit)) : filteredMembers.length;
  const offset = Number.isFinite(Number(query.offset)) ? Math.max(0, Number(query.offset)) : 0;
  const pagedMembers = filteredMembers.slice(offset, offset + limit);

  await recordAuditLogBestEffort({
    actorUserId,
    organizationId,
    action: AUDIT_ACTIONS.OWNER_ORGANIZATION_DIRECTORY_ACCESS,
    result: AUDIT_RESULTS.SUCCESS,
    metadata: { ...buildAuditContext({ authUser, internalUser, organization: { id: organizationId, name: profile?.nameCache } }), accessMode, memberCount: pagedMembers.length, totalMatched: filteredMembers.length },
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
    pagination: { total: filteredMembers.length, limit, offset },
    members: pagedMembers,
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

const logSessionResolutionError = (error) => {
  console.error("Failed to resolve internal user", {
    message: error?.message,
    code: error?.code,
    status: error?.status,
    diagnostic: error?.diagnostic,
    cause: error?.cause
      ? {
          code: error.cause.code,
          detail: error.cause.detail,
          table: error.cause.table,
          column: error.cause.column,
          constraint: error.cause.constraint,
          schema: error.cause.schema,
        }
      : undefined,
    stack: process.env.NODE_ENV === "production" ? undefined : error?.stack,
  });
};

const sendSessionResolutionError = (res, error, { allowLogtoTimeout = false } = {}) => {
  if (error.status === 401) return res.status(401).json({ error: "Unauthorized", message: error.message });
  if (error.status === 403) return res.status(403).json({ error: "Forbidden", message: error.message });
  const isSchemaDrift = error?.code === "DATABASE_SCHEMA_DRIFT";
  const isDatabaseTimeout = error?.code === "DATABASE_CONNECTION_TIMEOUT" || error?.code === "DATABASE_OPERATION_TIMEOUT";
  const isSessionUserTimeout = error?.code === "SESSION_INTERNAL_USER_TIMEOUT";
  const isLogtoTimeout = error?.code === "LOGTO_MANAGEMENT_REQUEST_TIMEOUT" || error?.code === "LOGTO_MANAGEMENT_TOKEN_TIMEOUT";
  const status = allowLogtoTimeout && isLogtoTimeout ? 504 : error?.status || 500;
  logSessionResolutionError(error);
  const responseStatus = isSchemaDrift || isDatabaseTimeout || isSessionUserTimeout ? 503 : status;
  const message = isSchemaDrift
    ? "Database schema is not compatible with the running backend. Run migrations before retrying."
    : isDatabaseTimeout
      ? "Database did not respond in time while resolving the session."
      : isSessionUserTimeout
        ? "Session bootstrap timed out while resolving the internal user."
        : "Failed to resolve session";
  return res.status(responseStatus).json({
    error: responseStatus === 503 ? "Service Unavailable" : responseStatus === 504 ? "Gateway Timeout" : responseStatus === 502 ? "Bad Gateway" : "Internal Server Error",
    message,
    code: error?.code || undefined,
    diagnostic: error?.diagnostic || undefined,
  });
};

app.get("/me", requireAuth(API_RESOURCE), async (req, res) => {
  try {
    const internalUser = await resolveInternalUserForSession(req.user);
    return res.json({
      user: serializeUser(internalUser),
      identity: buildRequestIdentity(req.user, internalUser),
      auth: buildAuthorizationMetadata(req.user),
    });
  } catch (error) {
    return sendSessionResolutionError(res, error);
  }
});

app.get("/me/profile", requireAuth(API_RESOURCE), async (req, res) => {
  try {
    const logtoUser = await getLogtoUserById(req.user.sub);
    return res.json({
      identity: getLogtoUserIdentityFields(logtoUser),
      authorization: buildAuthorizationMetadata(req.user),
      sourcePolicy: {
        identity: "logto_management_api",
        authorization: "access_token_claims",
        canonicalSource: "logto",
      },
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return sendSessionResolutionError(res, error, { allowLogtoTimeout: true });
  }
});

app.get("/owner/me", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  try {
    const internalUser = await getOrCreateInternalUser(req.user);
    const capabilities = buildOwnerCapabilities(req.user);
    return res.json({
      owner: {
        logtoUserId: req.user.sub,
        internalUserId: internalUser.id,
        authorizedBy: "logto_global_role_and_scope",
        requiredScope: "owner:read",
        requiredWriteScope: "owner:write",
        canReadOwner: capabilities.canReadOwner,
        canWriteOwner: capabilities.canWriteOwner,
        globalRoles: capabilities.globalRoles,
        scopes: capabilities.scopes,
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
    await cleanupOrphanedOrganizationProfiles({ logtoOrganizations, profiles: rawProfiles });
    const profiles = reconcileProfilesWithLogtoOrganizations({ logtoOrganizations, profiles: rawProfiles });
    return res.json(await buildLogtoOrganizationDirectory({ logtoOrganizations, profiles }));
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


async function checkOwnerIntegrationHealth() {
  const checkedAt = new Date().toISOString();
  const makeCheck = async ({ key, label, system, required = true, run, notConfiguredMessage = "No configurado" }) => {
    try {
      const result = await run();
      return { key, label, system, required, status: result.status || "ok", severity: result.severity || "success", message: result.message || "Conexión verificada", checkedAt, details: result.details || null, nextAction: result.nextAction || null };
    } catch (error) {
      const missingConfig = error.code?.includes?.("CONFIG_MISSING") || /required|missing|not configured|no configur/i.test(error.message || "");
      return { key, label, system, required, status: missingConfig ? "not_configured" : "error", severity: required ? "danger" : "warning", message: missingConfig ? notConfiguredMessage : getSafeErrorMessage(error), checkedAt, details: error.diagnostic || error.body || null, nextAction: missingConfig ? "Configurar credenciales/URL en variables de entorno." : "Revisar credenciales, permisos y conectividad desde soporte." };
    }
  };
  const workerHealth = getWorkerHealthSnapshot();
  const checks = await Promise.all([
    makeCheck({ key: "redis", label: "Redis / BullMQ", system: "redis", run: async () => ({ status: workerHealth.redis.status === "error" ? "error" : workerHealth.redis.status === "unknown" ? "unknown" : "ok", severity: workerHealth.redis.status === "error" ? "danger" : workerHealth.redis.status === "unknown" ? "warning" : "success", message: workerHealth.redis.status === "error" ? "Redis no disponible para colas operativas." : workerHealth.redis.status === "unknown" ? "Redis no reporta estado activo; configura REDIS_STATUS/monitor real." : "Redis operativo para colas.", details: { readiness: workerHealth.readiness, redisUrlConfigured: Boolean(process.env.REDIS_URL), queues: workerHealth.queues } }) }),
    makeCheck({ key: "logto", label: "Logto Management API", system: "logto", run: async () => { const roles = await listLogtoOrganizationRoles(); return { status: "ok", message: "Logto responde y expone roles de organización.", details: { roleCount: roles.length } }; } }),
    makeCheck({ key: "fluentcrm", label: "FluentCRM", system: "fluentcrm", run: async () => ({ ...(await validateFluentCrmConfiguration()), message: "FluentCRM configurado y alcanzable." }), notConfiguredMessage: "FluentCRM no está configurado para sincronización downstream." }),
    makeCheck({ key: "wordpress", label: "WordPress", system: "wordpress", run: async () => { const roles = await listWordPressRoles(); return { status: "ok", message: "WordPress responde con catálogo de roles.", details: { roleCount: roles.length } }; }, notConfiguredMessage: "WordPress no está configurado para sincronización de roles/downstream." }),
    Promise.resolve({ key: "moodle", label: "Moodle", system: "moodle", required: false, status: process.env.MOODLE_BASE_URL ? "pending_integration" : "not_configured", severity: "secondary", message: process.env.MOODLE_BASE_URL ? "Moodle tiene URL configurada; falta activar el conector operacional." : "Preparado para integración futura de Moodle; aún no es requerido.", checkedAt, details: { baseUrlConfigured: Boolean(process.env.MOODLE_BASE_URL), roadmap: "future_lms_downstream_sync" }, nextAction: "Cuando se integre Moodle, conectar este check a su health endpoint y mappings." }),
  ]);
  const requiredChecks = checks.filter((check) => check.required !== false);
  const hasError = requiredChecks.some((check) => ["error"].includes(check.status));
  const hasWarning = requiredChecks.some((check) => ["unknown", "not_configured"].includes(check.status));
  return { checkedAt, status: hasError ? "degraded" : hasWarning ? "attention" : "ok", checks };
}

app.get("/owner/system/worker-queues", requireAuth(API_RESOURCE), requireOwner, async (_req, res) => {
  try {
    return res.json(await loadWorkerQueuesObservability());
  } catch (error) {
    console.error("Failed to load worker queues observability", error);
    return res.status(500).json({ error: "Worker queues observability unavailable", message: "No se pudo cargar la observabilidad agregada de worker y colas." });
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


app.get("/owner/system/metrics", requireAuth(API_RESOURCE), requireOwner, async (_req, res) => {
  try {
    return res.json(await loadOwnerSystemMetrics());
  } catch (error) {
    console.error("Failed to load owner system metrics", { message: getSafeErrorMessage(error) });
    return res.status(500).json({ error: "Owner system metrics unavailable", message: "No se pudieron cargar las métricas operativas Redis/BullMQ." });
  }
});

app.get("/owner/system/integrations-health", requireAuth(API_RESOURCE), requireOwner, async (_req, res) => {
  try {
    return res.json(await checkOwnerIntegrationHealth());
  } catch (error) {
    console.error("Failed to load integration health", error);
    return res.status(500).json({ error: "Integration health unavailable", message: "No se pudo cargar la salud de integraciones." });
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
    const directory = await buildLogtoOrganizationDirectory({ logtoOrganizations, profiles });
    return res.json({ organizations: directory.organizations, reconciliationIncidents: directory.reconciliationIncidents, unreconciledProfiles: directory.unreconciledProfiles });
  } catch (error) {
    console.error("Failed to list owner organizations from Logto", error);
    return res.status(502).json({ error: "Bad Gateway", message: "Failed to list canonical organizations from Logto" });
  }
});


app.get("/owner/bootstrap/micro-requests", requireAuth(API_RESOURCE), requireOwner, async (_req, res) => {
  try {
    const microRequests = await listOpenMicroRequests({ limit: 100 });
    return res.json({ microRequests });
  } catch (error) {
    return res.status(500).json({ error: "Internal Server Error", message: getSafeErrorMessage(error) });
  }
});

app.post("/owner/bootstrap/micro-requests/:microRequestId/retry", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  try {
    const microRequest = await markMicroRequestForRetry({ id: req.params.microRequestId });
    if (!microRequest) return res.status(404).json({ error: "Not Found", message: "Micro-request not found" });
    return res.json({ microRequest, status: "queued", note: "Micro-request queued for the next orchestration worker pass; no full organization resubmit is required." });
  } catch (error) {
    return res.status(500).json({ error: "Internal Server Error", message: getSafeErrorMessage(error) });
  }
});

function serializeSyncOperationStatus(operation) {
  const steps = operation.steps || [];
  const currentStep = steps.slice().reverse().find((step) => ["queued", "running"].includes(step.status)) || null;
  return {
    id: operation.id,
    operationType: operation.operationType,
    entityType: operation.entityType,
    entityId: operation.entityId,
    logtoOrganizationId: operation.logtoOrganizationId,
    logtoUserId: operation.logtoUserId,
    status: operation.status,
    canonicalStatus: operation.canonicalStatus,
    downstreamStatus: operation.downstreamStatus,
    currentStep: currentStep?.stepName || null,
    completedSteps: steps.filter((step) => step.status === "completed").map((step) => step.stepName),
    failedSteps: steps.filter((step) => step.status === "failed").map((step) => ({ stepName: step.stepName, error: step.lastErrorJson })),
    lastError: operation.lastErrorJson,
    retryable: operation.lastErrorJson?.retryable ?? null,
    correlationId: operation.correlationId,
    idempotencyKey: operation.idempotencyKey,
    payloadSnapshot: operation.payloadSnapshotJson,
    resultSnapshot: operation.resultSnapshotJson,
    retryCount: operation.retryCount,
    steps,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    finishedAt: operation.finishedAt,
  };
}

app.get("/owner/operations/:operationId", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  try {
    const operation = await getSyncOperationWithSteps(req.params.operationId);
    if (!operation) return res.status(404).json({ error: "Not Found", message: "Operation not found" });
    return res.json({ operation: serializeSyncOperationStatus(operation) });
  } catch (error) {
    return res.status(500).json({ error: "Internal Server Error", message: getSafeErrorMessage(error) });
  }
});

app.get("/owner/organizations/:organizationId/provisioning-status", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  try {
    const operation = await getLatestOperationForOrganization(req.params.organizationId);
    if (!operation) return res.status(404).json({ error: "Not Found", message: "Provisioning operation not found for organization" });
    return res.json({
      organizationId: req.params.organizationId,
      operation: serializeSyncOperationStatus(operation),
    });
  } catch (error) {
    return res.status(500).json({ error: "Internal Server Error", message: getSafeErrorMessage(error) });
  }
});

app.post("/owner/organizations", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  if (String(process.env.ORGANIZATION_BOOTSTRAP_ORCHESTRATION || "true").toLowerCase() !== "false") {
    try {
      const { operation, jobId } = await enqueueOrganizationBootstrap({ body: req.body || {}, authUser: req.user });
      return res.status(202).json({
        operationId: operation.id,
        status: operation.status,
        statusUrl: `/owner/operations/${operation.id}`,
        canonicalStatus: operation.canonicalStatus,
        downstreamStatus: operation.downstreamStatus,
        correlationId: operation.correlationId,
        organizationId: operation.logtoOrganizationId || null,
        jobId,
        sourceOfTruth: "logto",
        message: "Organization bootstrap was queued. Logto canonical provisioning will run in the worker before downstream FluentCRM propagation.",
      });
    } catch (error) {
      if (error.status === 400) return res.status(400).json({ error: "Bad Request", message: error.message, details: error.details || [] });
      if (/REDIS_URL/.test(error.message)) return res.status(503).json({ error: "Service Unavailable", message: error.message });
      console.error("Failed to enqueue organization bootstrap", error);
      return res.status(500).json({ error: "Internal Server Error", message: getSafeErrorMessage(error) });
    }
  }

  let internalUser = null;
  let logtoOrganization = null;
  let logtoOrganizationId = null;
  let canonicalCreated = false;
  let bootstrapOperation = null;
  let bootstrapMicroRequests = [];

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

    try {
      bootstrapOperation = await createBootstrapOperation({ actorUserId: internalUser.id, payloadSnapshot: req.body || {} });
    } catch (operationError) {
      console.error("Failed to persist bootstrap operation snapshot", operationError);
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
        crmInput: { companyOwner: canonicalInput.value.administrativeContacts?.[0]?.name, companyEmail: canonicalInput.value.administrativeContacts?.[0]?.email, companyPhone: canonicalInput.value.administrativeContacts?.[0]?.phone, ...(req.body?.crm || req.body?.fluentcrm || {}) },
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

    if (bootstrapOperation?.id) {
      try {
        bootstrapMicroRequests = buildMicroRequestsForFluentCrmStep({
          parentOperationId: bootstrapOperation.id,
          logtoOrganizationId,
          fluentCrmStep,
          payloadSnapshot: req.body || {},
        });
        const insertedMicroRequests = await insertMicroRequests(bootstrapMicroRequests);
        bootstrapMicroRequests = insertedMicroRequests;
        await updateBootstrapOperation({
          id: bootstrapOperation.id,
          status: insertedMicroRequests.length ? BOOTSTRAP_OPERATION_STATUSES.PARTIAL : BOOTSTRAP_OPERATION_STATUSES.SUCCEEDED,
          logtoOrganizationId,
          organizationProfileId: fluentCrmStep.profile?.id || null,
          stepResults: {
            logtoOrganization: { status: result.reconciled ? "reconciled" : "created", id: logtoOrganizationId },
            legacyBaseAdmin: null,
            administrativeContactSeed: result.adminAssignment || null,
            administrativeContacts: result.administrativeContactAssignments || [],
            fluentcrm: fluentCrmStep,
            microRequestCount: insertedMicroRequests.length,
          },
          lastError: crmWarning ? { message: crmWarning, fluentcrm: fluentCrmStep } : null,
        });
      } catch (operationError) {
        console.error("Failed to persist bootstrap micro-requests", operationError);
      }
    }

    const followUpWarning = crmWarning || (bootstrapMicroRequests.length ? "La organización fue creada en Logto, pero quedaron micro-solicitudes downstream pendientes para reintentar sin reenviar todo el formulario." : null);

    return res.status(201).json({
      organization: fluentCrmStep.profile ? serializeOwnerOrganization(fluentCrmStep.profile, logtoOrganization) : serializeLogtoOwnerOrganization(logtoOrganization, logtoOrganizationId),
      status: followUpWarning ? "created_in_logto_with_followup_micro_requests" : result.status,
      sourceOfTruth: "logto",
      customDataApplied: result.customDataApplied,
      reconciled: result.reconciled,
      steps: {
        logtoOrganization: { status: result.reconciled ? "reconciled" : "created", id: logtoOrganizationId },
        administrativeContactUser: { status: result.adminAssignment?.userCreated ? "created" : "resolved", logtoUserId: result.adminAssignment?.logtoUserId, source: result.adminAssignment?.userSource },
        administrativeContactMembership: { status: result.adminAssignment?.membershipAdded ? "added" : "not_added" },
        administrativeContactRole: { status: result.adminAssignment?.roleAssigned ? "assigned" : "not_assigned", roleName: result.adminAssignment?.roleName },
        administrativeContacts: { status: result.administrativeContactAssignments?.length ? "assigned" : "not_requested", contacts: result.administrativeContactAssignments || [] },
        jitProvisioning: { status: result.jitProvisioning?.status, domainConfigured: result.jitProvisioning?.domainConfigured, domain: result.jitProvisioning?.domain },
        jitDefaultRoles: { status: result.jitProvisioning?.defaultRolesConfigured ? "configured" : "not_configured", roleNames: result.jitProvisioning?.defaultRoleNames },
        fluentcrm: fluentCrmStep,
      },
      fluentcrm: fluentCrmStep,
      warning: followUpWarning || undefined,
      bootstrapOperation: bootstrapOperation ? { id: bootstrapOperation.id, status: bootstrapMicroRequests.length ? "partial" : "succeeded", microRequestCount: bootstrapMicroRequests.length, microRequests: bootstrapMicroRequests } : undefined,
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

    if (bootstrapOperation?.id) {
      try {
        await updateBootstrapOperation({ id: bootstrapOperation.id, status: BOOTSTRAP_OPERATION_STATUSES.FAILED, logtoOrganizationId, lastError: { message: errorMessage, code: error.code || null } });
      } catch (operationError) {
        console.error("Failed to mark bootstrap operation failed", operationError);
      }
    }

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


function normalizeMemberCreateInput(body = {}, organizationId) {
  const trim = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const primerNombre = trim(body.firstName ?? body.primerNombre);
  const segundoNombre = trim(body.middleName ?? body.segundoNombre);
  const primerApellido = trim(body.firstSurname ?? body.primerApellido);
  const segundoApellido = trim(body.secondSurname ?? body.segundoApellido);
  const email = trim(body.email)?.toLowerCase() || null;
  const phone = trim(body.phone);
  const phoneExtension = trim(body.phoneExtension);
  const position = trim(body.position);
  const organizationRoleName = trim(body.organizationRoleName);
  const name = [primerNombre, segundoNombre, primerApellido, segundoApellido].filter(Boolean).join(" ");
  const errors = [];
  if (!primerNombre) errors.push({ field: "primerNombre", message: "Nombre 1 es requerido" });
  if (!primerApellido) errors.push({ field: "primerApellido", message: "Apellido 1 es requerido" });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push({ field: "email", message: "Email válido es requerido" });
  if (!organizationRoleName) errors.push({ field: "organizationRoleName", message: "Rol de organización es requerido" });
  return { errors, value: { primerNombre, segundoNombre, primerApellido, segundoApellido, email, phone, phoneExtension, position, organizationRoleName, organizationId, name, username: buildLogtoUsername({ email }) } };
}


app.post("/owner/organizations/:organizationId/members", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  let operation = null;
  try {
    const internalUser = await getOrCreateInternalUser(req.user);
    const normalized = normalizeMemberCreateInput(req.body || {}, req.params.organizationId);
    if (normalized.errors.length) return res.status(400).json({ error: "Bad Request", details: normalized.errors });
    const payload = normalized.value;
    operation = await createSyncOperation({ operationType: "organization_member_create", entityType: "organization_member", entityId: req.params.organizationId, logtoOrganizationId: req.params.organizationId, idempotencyKey: req.body?.idempotencyKey || `organization_member_create:${req.params.organizationId}:${payload.email}`, payloadSnapshotJson: { ...payload, hitlStatuses: ["pending", "queued", "processing", "hitl_required", "resolved", "failed", "retryable"] } });
    const role = await findOrganizationRoleByName(payload.organizationRoleName);
    const roleId = role?.id || role?.organizationRoleId || role?.roleId;
    if (!roleId) throw Object.assign(new Error(`Organization role ${payload.organizationRoleName} does not exist`), { status: 409, hitl: "rol seleccionado no existe en la plantilla" });
    const userPayload = buildLogtoUserCreatePayload({ email: payload.email, phone: payload.phone, username: payload.username, name: payload.name, firstName: payload.primerNombre, middleName: payload.segundoNombre, firstSurname: payload.primerApellido, secondSurname: payload.segundoApellido, position: payload.position, phoneExtension: payload.phoneExtension });
    userPayload.customData = { ...(userPayload.customData || {}), civitasProfile: { ...(userPayload.customData?.civitasProfile || {}), position: payload.position, phoneExtension: payload.phoneExtension, source: "owner_add_user" } };
    const resolved = await createOrResolveLogtoUserByEmail(userPayload);
    const logtoUserId = resolved.user?.id || resolved.user?.userId || resolved.user?.logtoUserId;
    if (!logtoUserId) throw new Error("Logto user upsert did not return an id");
    await addUserToLogtoOrganization({ organizationId: req.params.organizationId, userId: logtoUserId });
    await assignOrganizationRoleToUser({ organizationId: req.params.organizationId, userId: logtoUserId, organizationRoleId: roleId, organizationRoleName: payload.organizationRoleName });
    await db.update(syncOperations).set({ status: "completed", canonicalStatus: "completed", downstreamStatus: "queued", logtoUserId, resultSnapshotJson: { logtoUserId, userCreated: Boolean(resolved.created), roleName: payload.organizationRoleName }, updatedAt: new Date() }).where(eq(syncOperations.id, operation.id));
    await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: req.params.organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "organization_member_create", syncOperationId: operation.id, logtoUserId, email: payload.email, roleName: payload.organizationRoleName, downstreamSync: "queued" } });
    return res.status(202).json({ status: "queued", operationType: "organization_member_create", syncOperation: operation, logtoUserId, roleName: payload.organizationRoleName, message: "Miembro creado/vinculado en Logto; downstream queda registrado para worker/reintento si aplica." });
  } catch (error) {
    if (operation?.id) await db.update(syncOperations).set({ status: "hitl_required", canonicalStatus: "failed", downstreamStatus: "pending", lastErrorJson: { message: getSafeErrorMessage(error), retryable: false, hitl: error.hitl || "conflicto requiere revisión humana" }, updatedAt: new Date() }).where(eq(syncOperations.id, operation.id)).catch(() => {});
    return res.status(error.status || 502).json({ error: "Member create requires review", message: safeFunctionalMessage(getSafeErrorMessage(error), "No se pudo completar la creación del miembro; quedó como tarea HITL/reintento."), status: "hitl_required", syncOperationId: operation?.id || null });
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
    const operation = await createSyncOperation({ operationType: "member_identity_downstream_sync", entityType: "organization_member", entityId: req.params.logtoUserId, logtoOrganizationId: req.params.organizationId, logtoUserId: req.params.logtoUserId, correlationId: `member-identity:${req.params.organizationId}:${req.params.logtoUserId}:${Date.now()}`, idempotencyKey: req.body?.idempotencyKey || `member-identity:${req.params.organizationId}:${req.params.logtoUserId}:${email}:${previousEmail}`, payloadSnapshotJson: { logtoUserId: req.params.logtoUserId, previousEmail, email, name, phone, organizationRoleName: req.body?.organizationRoleName || req.body?.roleName || null, sourceOfTruth: "logto" } });
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
    const trim = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
    const email = trim(req.body?.email)?.toLowerCase() || null;
    const phone = trim(req.body?.phone);
    const previousEmail = trim(req.body?.previousEmail)?.toLowerCase() || email;
    const primerNombre = trim(req.body?.firstName ?? req.body?.primerNombre);
    const segundoNombre = trim(req.body?.middleName ?? req.body?.segundoNombre);
    const primerApellido = trim(req.body?.firstSurname ?? req.body?.primerApellido);
    const segundoApellido = trim(req.body?.secondSurname ?? req.body?.segundoApellido);
    const name = trim(req.body?.name) || [primerNombre, segundoNombre, primerApellido, segundoApellido].filter(Boolean).join(" ") || null;
    if (!primerNombre || !primerApellido || !email) return res.status(400).json({ error: "Bad Request", message: "Nombre 1, Apellido 1 y email son requeridos" });
    const previousUser = await getLogtoUserById(req.params.logtoUserId).catch(() => null);
    const previousCustomData = previousUser?.customData && typeof previousUser.customData === "object" ? previousUser.customData : {};
    const previousProfile = previousUser?.profile && typeof previousUser.profile === "object" ? previousUser.profile : {};
    const customData = { ...previousCustomData, secondFamilyName: segundoApellido || undefined };
    const profile = { ...previousProfile, givenName: primerNombre, middleName: segundoNombre || undefined, familyName: primerApellido };
    const logtoUser = await updateLogtoUser({ userId: req.params.logtoUserId, email, name, phone, profile, customData });
    const operation = await createSyncOperation({ operationType: "member_identity_downstream_sync", entityType: "organization_member", entityId: req.params.logtoUserId, logtoOrganizationId: req.params.organizationId, logtoUserId: req.params.logtoUserId, correlationId: `member-identity:${req.params.organizationId}:${req.params.logtoUserId}:${Date.now()}`, idempotencyKey: req.body?.idempotencyKey || `member-identity:${req.params.organizationId}:${req.params.logtoUserId}:${email}:${previousEmail}:${name}`, payloadSnapshotJson: { logtoUserId: req.params.logtoUserId, previousEmail, email, name, phone, primerNombre, segundoNombre, primerApellido, segundoApellido, position: trim(req.body?.position), phoneExtension: trim(req.body?.phoneExtension), organizationRoleName: req.body?.organizationRoleName || req.body?.roleName || null, sourceOfTruth: "logto" } });
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
    const operation = await createSyncOperation({ operationType: "member_reset_password", entityType: "organization_member", entityId: req.params.logtoUserId, logtoOrganizationId: req.params.organizationId, logtoUserId: req.params.logtoUserId, correlationId: `member-reset:${req.params.organizationId}:${req.params.logtoUserId}:${Date.now()}`, idempotencyKey: req.body?.idempotencyKey || `member-reset:${req.params.organizationId}:${req.params.logtoUserId}:${Date.now()}`, payloadSnapshotJson: { logtoUserId: req.params.logtoUserId, sourceOfTruth: "logto", policy: "provider_capability_only_no_local_reset" } });
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
  const existingBusiness = normalizeBusinessLocationState(customData.civitasProfile?.business || {});
  const business = normalizeBusinessLocationState({ ...existingBusiness, ...(patch.business || {}) });
  const appSubdomain = firstValue(business.appSubdomain, customData.provisioning?.appSubdomain, business.subdomain);
  const appBaseDomain = firstValue(business.appBaseDomain, customData.provisioning?.appBaseDomain);
  const validEntry = appSubdomain && APP_BASE_DOMAINS.includes(appBaseDomain);
  if (validEntry) business.entryUrl = buildEntryUrl(appSubdomain, appBaseDomain);
  return {
    ...customData,
    ...(validEntry ? { provisioning: { ...(customData.provisioning || {}), appSubdomain, appBaseDomain, entryUrl: business.entryUrl }, oidcRedirectUri: `${business.entryUrl}/callback` } : {}),
    civitasProfile: {
      version: 1,
      ...(customData.civitasProfile && typeof customData.civitasProfile === "object" ? customData.civitasProfile : {}),
      business,
      contact: { ...(customData.civitasProfile?.contact || {}), ...(patch.contact || {}) },
      branding: { ...incomingBranding, ...generatedBranding.normalized, logtoCustomCss: generatedBranding.css, customCssGeneratedAt: new Date().toISOString() },
      downstream: { ...(customData.civitasProfile?.downstream || {}), ...(patch.downstream || {}) },
      updatedAt: new Date().toISOString(),
    },
  };
};

const firstValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== "") ?? null;

const normalizeBusinessLocationState = (business = {}) => {
  if (!business || typeof business !== "object" || Array.isArray(business)) return {};
  const { department, ...rest } = business;
  return { ...rest, state: firstValue(business.state, department) };
};

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
  const derivedEntry = deriveAppEntryFromOidcRedirectUri(typeof customData.oidcRedirectUri === "string" ? customData.oidcRedirectUri : null);
  const readAppSubdomain = firstValue(business.appSubdomain, provisioning.appSubdomain, derivedEntry.appSubdomain, business.subdomain, profile?.subdomain);
  const readAppBaseDomain = firstValue(business.appBaseDomain, provisioning.appBaseDomain, derivedEntry.appBaseDomain);
  const readEntryUrl = readAppSubdomain && readAppBaseDomain ? buildEntryUrl(readAppSubdomain, readAppBaseDomain) : null;
  return {
    sourcePriority: ["logto.customData.civitasProfile", "logto.customData.provisioning", "fluentcrm.company", "civitas.operational_cache"],
    business: {
      /** @deprecated Legacy display-only identifier; never use for functional URLs/routing. */
      slug: firstValue(business.slug, provisioning.slug, profile?.slug),
      appSubdomain: readAppSubdomain,
      appBaseDomain: readAppBaseDomain,
      entryUrl: readEntryUrl,
      entryUrlInconsistency: readEntryUrl ? null : derivedEntry.inconsistency || "missing_app_entry_fields",
      /** @deprecated Compatibility alias for appSubdomain. */
      subdomain: readAppSubdomain,
      website: firstValue(business.website, crm.website, crm.url),
      institutionalDomain: firstValue(business.institutionalDomain, provisioning.institutionalDomain, profile?.adminDomain),
      nit: firstValue(business.nit, crm.nit, crm.custom_values?.nit),
      verificationDigit: firstValue(business.verificationDigit, crm.verification_digit, crm.custom_values?.verification_digit),
      country: firstValue(business.country, crm.country),
      state: firstValue(business.state, crm.state, business.department, crm.region),
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
    const primaryPending = pending[0] || null;
    return res.json({
      organization: serializeOwnerOrganization(profile, logtoOrganization),
      canonical: { source: "logto", topLevelFields: ["id", "name", "description"], customData: getLogtoOrganizationCustomData(logtoOrganization) },
      readModel: buildOrganizationProfileReadModel({ logtoOrganization, profile, fluentCrmCompany }),
      customDataShape: { root: "customData.civitasProfile", sections: ["business", "contact", "branding", "downstream"] },
      downstreamOnly: ["fluentcrmCompanyId", "fluentcrmSyncStatus", "fluentcrmContactSync"],
      sync: {
        pending,
        events,
        summary: {
          logto: profile?.logtoSyncStatus === "error" ? "error" : logtoOrganization ? "ok" : "missing",
          fluentcrmCompany: primaryPending?.entityType === "fluentcrm.company" ? primaryPending.humanMessage : profile?.fluentcrmCompanyId ? profile?.fluentcrmSyncStatus || "linked" : "Falta crear company en FluentCRM",
          fluentcrmContact: pending.find((item) => item.entityType === "fluentcrm.contact")?.humanMessage || "sin conflicto",
          lastStep: primaryPending?.stepName || null,
          lastRetry: primaryPending?.retryState || primaryPending?.status || null,
          queueName: primaryPending?.queueName || null,
          jobId: primaryPending?.jobId || null,
          queueStatus: primaryPending?.queueStatus || primaryPending?.retryState || null,
          executionSource: primaryPending?.executionSource || null,
          jobAgeSeconds: primaryPending?.jobAgeSeconds ?? null,
          workerHeartbeatState: primaryPending?.workerHeartbeatState || null,
        },
      },
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
        slug: profile.slug,
        adminDomain: customData.civitasProfile?.business?.institutionalDomain || profile.adminDomain,
        subdomain: customData.civitasProfile?.business?.appSubdomain || profile.subdomain,
        logoUrl: customData.civitasProfile?.branding?.logoUrl || profile.logoUrl,
        primaryColor: customData.civitasProfile?.branding?.primaryColor || profile.primaryColor,
        updatedAt: new Date(),
      }).where(eq(organizationProfiles.id, profile.id));
    }
    const requestedCustomData = req.body?.customData || {};
    const needsCrmProfileSync = Boolean(requestedCustomData.business || requestedCustomData.contact || requestedCustomData.downstream?.propagateTo?.includes?.("fluentcrm"));
    const operation = needsCrmProfileSync
      ? await createSyncOperation({ operationType: "organization_profile_downstream_sync", entityType: "organization", entityId: logtoOrganizationId, logtoOrganizationId, correlationId: `owner-profile:${logtoOrganizationId}:${Date.now()}`, idempotencyKey: req.body?.idempotencyKey || `owner-profile:${logtoOrganizationId}:${JSON.stringify(customData.civitasProfile || {})}`, payloadSnapshotJson: { source: "logto_customData.civitasProfile", target: "fluentcrm", requestedBy: "owner_console", customData: customData.civitasProfile || {} } })
      : await createSyncOperation({ operationType: "organization_branding_logto_sync", entityType: "branding", entityId: logtoOrganizationId, logtoOrganizationId, correlationId: `owner-branding:${logtoOrganizationId}:${Date.now()}`, idempotencyKey: req.body?.idempotencyKey || `owner-branding:${logtoOrganizationId}:${JSON.stringify(customData.civitasProfile?.branding || {})}`, payloadSnapshotJson: { source: "logto_customData.civitasProfile.branding", target: "logto_custom_css", requestedBy: "owner_console", branding: customData.civitasProfile?.branding || {} } });
    if (!needsCrmProfileSync) {
      await recordOperationStep({ operationId: operation.id, stepName: "logto_custom_css_regenerated", queueName: "owner-profile", jobId: operation.id, status: "completed", outputJson: { result: { entityType: "branding", targetIdentity: { logtoOrganizationId }, fieldsSent: Object.keys(customData.civitasProfile?.branding || {}), missingFields: [], fieldDiffs: {}, providerStatus: "completed", providerCode: null, humanMessage: "Branding: logto_custom_css regenerado" } } });
      await updateSyncOperation({ id: operation.id, status: "completed", canonicalStatus: "completed", downstreamStatus: "completed", resultSnapshotJson: { workerOutcome: { status: "completed", result: { entityType: "branding", humanMessage: "Branding: logto_custom_css regenerado" } } } });
    }
    await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId: logtoOrganizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: needsCrmProfileSync ? "organization_profile_custom_data_updated" : "organization_branding_custom_data_updated", syncOperationId: operation.id, sourceOfTruth: "logto.customData" } });
    return res.json({ status: needsCrmProfileSync ? "updated_sync_queued" : "branding_updated", organization: serializeOwnerOrganization(profile, updated), syncOperation: operation });
  } catch (error) {
    await recordAuditLogBestEffort({ actorUserId: internalUser?.id ?? null, organizationId: req.params.organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.ERROR, metadata: { stage: "organization_profile_custom_data_update_failed", error } });
    return res.status(error.status || 502).json({ error: "Profile update failed", message: safeFunctionalMessage(getSafeErrorMessage(error), "No se pudo guardar el perfil en Logto.") });
  }
});


app.get("/owner/organizations/:organizationId/operational-state", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  try {
    const profile = await resolveOrganizationProfileForRequest(req.params.organizationId);
    const logtoOrganizationId = profile?.logtoOrganizationId || req.params.organizationId;
    const generatedAt = new Date();
    // getWorkerHealthSnapshot() is intentionally synchronous: it returns the last
    // cached snapshot and triggers an async refresh internally when stale.
    const workerHealth = getWorkerHealthSnapshot();
    const [logtoOrganization, pending, events] = await Promise.all([
      getLogtoOrganizationById(logtoOrganizationId).catch((error) => {
        console.warn("Operational state degraded: Logto organization unavailable", { logtoOrganizationId, error: getSafeErrorMessage(error) });
        return { _unavailable: true, _error: getSafeErrorMessage(error) };
      }),
      listOrganizationPendingSync({ organizationId: logtoOrganizationId }).catch((error) => {
        console.warn("Operational state degraded: pending sync unavailable", { logtoOrganizationId, error: getSafeErrorMessage(error) });
        return [];
      }),
      listOrganizationEvents({ organizationId: logtoOrganizationId }).catch((error) => {
        console.warn("Operational state degraded: events unavailable", { logtoOrganizationId, error: getSafeErrorMessage(error) });
        return [];
      }),
    ]);

    const response = buildConsolidatedOperationalResponse({
      organization: {
        logtoOrganizationId,
        name: getLogtoOrganizationName(logtoOrganization) || profile?.nameCache || null,
        profileId: profile?.id || null,
        sourceAnchors: { logtoOrganizationId },
      },
      logtoOrganization,
      profile,
      pending,
      events,
      workerHealth,
      generatedAt,
      compatibility: {
        legacyProfileEndpoint: `/owner/organizations/${encodeURIComponent(logtoOrganizationId)}/profile`,
        preservedFields: ["sync.pending", "sync.summary", "operationalStatus", "providerVerificationLabel"],
      },
    });
    return res.json(response);
  } catch (error) {
    console.error("Failed to load consolidated operational state", error);
    return res.status(error.status || 502).json({ error: "Operational state unavailable", message: "No se pudo cargar el contrato operacional consolidado." });
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
  const pending = (await listOrganizationPendingSync({ organizationId }).catch(() => [])).find((item) => item.operationId === operation.id) || null;
  await recordAuditLogBestEffort({ organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "retry requested", operationId: req.params.operationId, stepName: pending?.stepName || operation.operationType, entityType: pending?.entityType || "sync.operation", targetIdentity: pending?.targetIdentity || organizationId, humanMessage: pending?.entityType === "fluentcrm.company" ? "Retry solicitado para FluentCRM company" : pending?.entityType === "fluentcrm.contact" ? "Retry solicitado para FluentCRM contact" : "Retry solicitado para operación downstream", providerCode: pending?.providerCode || null, providerStatus: pending?.providerStatus || null, queueName: pending?.queueName || null, jobId: pending?.jobId || null, retryState: pending?.retryState || operation.status, enqueuedAt: pending?.enqueuedAt || null, workerHeartbeatState: pending?.workerHeartbeatState || null, jobAgeSeconds: pending?.jobAgeSeconds ?? null } });
  await recordAuditLogBestEffort({ organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "retry enqueued", operationId: operation.id, stepName: pending?.stepName || operation.operationType, entityType: pending?.entityType || "sync.operation", targetIdentity: pending?.targetIdentity || organizationId, humanMessage: pending?.entityType === "fluentcrm.company" ? "Retry encolado para FluentCRM company" : pending?.entityType === "fluentcrm.contact" ? "Retry encolado para FluentCRM contact" : "Retry encolado para operación downstream", queueName: pending?.queueName || null, jobId: pending?.jobId || null, retryState: pending?.retryState || "queued", enqueuedAt: pending?.enqueuedAt || null, workerHeartbeatState: pending?.workerHeartbeatState || null, jobAgeSeconds: pending?.jobAgeSeconds ?? null } });
  return res.json({ status: "retry_queued", operation, pending });
});

app.post("/owner/organizations/:organizationId/sync-operations/:operationId/resend-payload", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  let internalUser = null;
  try {
    internalUser = await getOrCreateInternalUser(req.user);
    const profile = await resolveOrganizationProfileForRequest(req.params.organizationId);
    const organizationId = profile?.logtoOrganizationId || req.params.organizationId;
    const result = await resendSyncOperationPayload({ operationId: req.params.operationId, organizationId, actorUserId: internalUser.id });
    await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "resend_payload.enqueued", originalOperationId: req.params.operationId, operationId: result.operation.id, stepName: result.stepName, targetIdentity: result.operation.entityId || organizationId, queueName: result.enqueueResult.queueName || null, jobId: result.enqueueResult.jobId || null, humanMessage: "Payload reenviado por owner y microacción encolada" } });
    return res.json({ status: "payload_resend_queued", operation: result.operation, originalOperationId: req.params.operationId, stepName: result.stepName });
  } catch (error) {
    await recordAuditLogBestEffort({ actorUserId: internalUser?.id ?? null, organizationId: req.params.organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.ERROR, metadata: { stage: "resend_payload.failed", operationId: req.params.operationId, reason: error.reason || error.message } });
    return res.status(error.status || 500).json({ error: "Payload resend failed", message: safeFunctionalMessage(getSafeErrorMessage(error), "No se pudo reenviar el payload."), reason: error.reason || null });
  }
});

app.post("/owner/organizations/:organizationId/sync-operations/:operationId/manual-resolution", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  let internalUser = null;
  try {
    internalUser = await getOrCreateInternalUser(req.user);
    const profile = await resolveOrganizationProfileForRequest(req.params.organizationId);
    const organizationId = profile?.logtoOrganizationId || req.params.organizationId;
    const result = await manualResolveSyncOperation({ operationId: req.params.operationId, stepId: req.body?.stepId || null, organizationId, resolutionType: req.body?.resolutionType, resolutionReason: req.body?.resolutionReason || null, notes: req.body?.notes || null, appliesUntil: req.body?.appliesUntil || null, resolvedByUserId: internalUser.id });
    await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "manual_resolution.recorded", operationId: req.params.operationId, resolutionId: result.resolution.id, resolutionType: result.resolution.resolutionType, humanMessage: "Resolución manual registrada sin afirmar éxito downstream" } });
    return res.json({ status: "manual_resolution_recorded", resolution: result.resolution });
  } catch (error) {
    await recordAuditLogBestEffort({ actorUserId: internalUser?.id ?? null, organizationId: req.params.organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.ERROR, metadata: { stage: "manual_resolution.failed", operationId: req.params.operationId, reason: error.message } });
    return res.status(error.status || 500).json({ error: "Manual resolution failed", message: safeFunctionalMessage(getSafeErrorMessage(error), "No se pudo registrar la resolución manual.") });
  }
});

app.post("/owner/organizations/:organizationId/sync-operations/:operationId/provider-verification", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  let internalUser = null;
  try {
    internalUser = await getOrCreateInternalUser(req.user);
    const profile = await resolveOrganizationProfileForRequest(req.params.organizationId);
    const organizationId = profile?.logtoOrganizationId || req.params.organizationId;
    const result = await verifySyncOperationProvider({ operationId: req.params.operationId, organizationId, actorUserId: internalUser.id });
    await recordAuditLogBestEffort({ actorUserId: internalUser.id, organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.SUCCESS, metadata: { stage: "provider_verification.started", operationId: result.operation.id, verificationOfOperationId: req.params.operationId, humanMessage: "Verificación live de proveedor solicitada explícitamente" } });
    return res.json({ status: "provider_verification_requested", operation: result.operation, providerVerification: result.providerVerification });
  } catch (error) {
    await recordAuditLogBestEffort({ actorUserId: internalUser?.id ?? null, organizationId: req.params.organizationId, action: AUDIT_ACTIONS.OWNER_ORGANIZATION_PROVISIONING, result: AUDIT_RESULTS.ERROR, metadata: { stage: "provider_verification.failed", operationId: req.params.operationId, reason: error.message } });
    return res.status(error.status || 500).json({ error: "Provider verification failed", message: safeFunctionalMessage(getSafeErrorMessage(error), "No se pudo solicitar la verificación live del proveedor.") });
  }
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
    const result = await buildOrganizationDirectoryResponse({ organizationId: req.params.organizationId, actorUserId: internalUser.id, accessMode: "owner_global", authUser: req.user, internalUser, query: req.query });
    return res.json(result);
  } catch (error) {
    console.error("Failed to build owner organization directory", error);
    return res.status(error.status || 502).json({ error: "Bad Gateway", message: getSafeErrorMessage(error), sourcePolicy: "logto_first_directory" });
  }
});

app.get("/organizations/:organizationId/directory", requireOrganizationAccess({ requiredScopes: ["organizations:read"], requiredRoleName: ORGANIZATION_ADMIN_ROLE_NAME }), async (req, res) => {
  try {
    const internalUser = await getOrCreateInternalUser(req.user);
    const result = await buildOrganizationDirectoryResponse({ organizationId: req.params.organizationId, actorUserId: internalUser.id, accessMode: "organization_admin", authUser: req.user, internalUser, query: req.query });
    return res.json(result);
  } catch (error) {
    console.error("Failed to build organization directory", error);
    return res.status(error.status || 502).json({ error: "Bad Gateway", message: getSafeErrorMessage(error), sourcePolicy: "logto_first_directory" });
  }
});

app.get("/owner/operational-logs", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  try {
    await getOrCreateInternalUser(req.user);
    return res.json(await listOperationalLogs({
      limit: req.query.limit,
      offset: req.query.offset,
      organizationId: req.query.organizationId,
      organizationName: req.query.organizationName,
      entityType: req.query.entityType,
      stepName: req.query.stepName,
      affectedSystem: req.query.affectedSystem || req.query.system,
      system: req.query.system,
      status: req.query.status,
      retryState: req.query.retryState,
      retryable: req.query.retryable,
      requiresHumanAction: req.query.requiresHumanAction,
      requiresAction: req.query.requiresAction,
      downstream: req.query.downstream,
      microAction: req.query.microAction,
      queueName: req.query.queueName,
      q: req.query.q,
      from: req.query.from,
      to: req.query.to,
    }));
  } catch (error) {
    console.error("Failed to list operational logs", { error, query: req.query, stage: "listOperationalLogs" });
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to list operational logs", diagnostic: { stage: "listOperationalLogs", reason: error.message } });
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
      { limit: req.query.limit, offset: req.query.offset, organizationId: req.query.organizationId, organizationName: req.query.organizationName, entityType: req.query.entityType, stepName: req.query.stepName, affectedSystem: req.query.affectedSystem || req.query.system, system: req.query.system, status: req.query.status, retryState: req.query.retryState, retryable: req.query.retryable, requiresHumanAction: req.query.requiresHumanAction, requiresAction: req.query.requiresAction, downstream: req.query.downstream, microAction: req.query.microAction, queueName: req.query.queueName, q: req.query.q, from: req.query.from, to: req.query.to },
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

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}

module.exports = { app, runFluentCrmOrganizationStep, runOrganizationContactSyncAfterCompany, buildContactSyncSettings };
