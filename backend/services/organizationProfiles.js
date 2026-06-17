const { eq, inArray, or } = require("drizzle-orm");
const { db } = require("../db/client");
const { organizationProfiles } = require("../db/schema");

const ORGANIZATION_PROFILE_STATUSES = Object.freeze({
  ACTIVE: "active",
  ORPHANED: "orphaned",
  ARCHIVED: "archived",
});

const FLUENTCRM_SYNC_STATUSES = Object.freeze({
  NOT_LINKED: "not_linked",
  LINKED: "linked",
  PENDING: "pending",
  CONFLICT: "conflict",
  ERROR: "error",
});

const LOGTO_SYNC_STATUSES = Object.freeze({
  PENDING: "pending",
  LOGTO_CREATED: "logto_created",
  METADATA_LINKED: "metadata_linked",
  BASE_ADMIN_INVITATION_PENDING: "base_admin_invitation_pending",
  BASE_MEMBER_PENDING: "base_member_pending",
  BASE_ROLE_PENDING: "base_role_pending",
  BOOTSTRAPPED: "bootstrapped",
  CREATOR_MEMBERSHIP_PENDING: "creator_membership_pending",
  CREATOR_ROLE_PENDING: "creator_role_pending",
  CREATOR_ROLE_MISSING: "creator_role_missing",
  BOOTSTRAP_INCOMPLETE: "bootstrap_incomplete",
  RECONCILED: "reconciled",
  SYNCED: "synced",
  ERROR: "error",
});

const toIso = (value) => value?.toISOString?.() ?? value;

const serializeOrganizationProfile = (profile) => ({
  id: profile.id,
  logtoOrganizationId: profile.logtoOrganizationId,
  nameCache: profile.nameCache,
  type: profile.type,
  status: profile.status,
  subdomain: profile.subdomain,
  slug: profile.slug,
  adminDomain: profile.adminDomain,
  branding: {
    logoUrl: profile.logoUrl,
    faviconUrl: profile.faviconUrl,
    primaryColor: profile.primaryColor,
    primaryColorDark: profile.primaryColorDark,
  },
  organizationLoginExperienceEnabled: profile.organizationLoginExperienceEnabled,
  defaultRoleNames: profile.defaultRoleNames || [],
  oidcApplicationId: profile.oidcApplicationId,
  oidcInitialConfig: profile.oidcInitialConfig || null,
  oidcApplicationSecretConfigured: Boolean(profile.oidcApplicationSecretRef),
  emailDomainProvisioningStatus: profile.emailDomainProvisioningStatus,
  settings: profile.settings || null,
  seatTotal: profile.seatTotal,
  logtoSyncStatus: profile.logtoSyncStatus,
  logtoSyncError: profile.logtoSyncError,
  logtoSyncedAt: toIso(profile.logtoSyncedAt),
  fluentcrmCompanyId: profile.fluentcrmCompanyId,
  fluentcrmSyncStatus: profile.fluentcrmSyncStatus,
  fluentcrmSyncError: profile.fluentcrmSyncError,
  fluentcrmSyncedAt: toIso(profile.fluentcrmSyncedAt),
  createdAt: toIso(profile.createdAt),
  updatedAt: toIso(profile.updatedAt),
});

const normalizeSeatTotal = (seatTotal) => {
  const value = Number(seatTotal);
  return Number.isInteger(value) && value >= 0 ? value : 0;
};

async function createOrganizationProfile({ nameCache, type, subdomain, slug, adminDomain, logoUrl, faviconUrl, primaryColor, primaryColorDark, organizationLoginExperienceEnabled = false, defaultRoleNames = [], oidcApplicationId = null, oidcInitialConfig = null, oidcApplicationSecretRef = null, emailDomainProvisioningStatus = "not_requested", settings = null, seatTotal }) {
  const now = new Date();
  const [profile] = await db
    .insert(organizationProfiles)
    .values({
      logtoOrganizationId: null,
      nameCache: nameCache || null,
      type: type || null,
      subdomain: subdomain || null,
      slug: slug || null,
      adminDomain: adminDomain || null,
      logoUrl: logoUrl || null,
      faviconUrl: faviconUrl || null,
      primaryColor: primaryColor || null,
      primaryColorDark: primaryColorDark || null,
      organizationLoginExperienceEnabled: Boolean(organizationLoginExperienceEnabled),
      defaultRoleNames,
      oidcApplicationId: oidcApplicationId || null,
      oidcInitialConfig,
      oidcApplicationSecretRef,
      emailDomainProvisioningStatus,
      settings,
      seatTotal: normalizeSeatTotal(seatTotal),
      logtoSyncStatus: LOGTO_SYNC_STATUSES.PENDING,
      logtoSyncError: null,
      logtoSyncedAt: null,
      fluentcrmCompanyId: null,
      fluentcrmSyncStatus: FLUENTCRM_SYNC_STATUSES.NOT_LINKED,
      fluentcrmSyncError: null,
      fluentcrmSyncedAt: null,
      updatedAt: now,
    })
    .returning();

  return profile;
}

async function markOrganizationProfileProvisioningStage({ id, logtoOrganizationId, nameCache, status, errorMessage = null, synced = false, settings }) {
  const now = new Date();
  const update = {
    logtoSyncStatus: status,
    logtoSyncError: errorMessage,
    updatedAt: now,
  };

  if (logtoOrganizationId !== undefined) update.logtoOrganizationId = logtoOrganizationId;
  if (nameCache !== undefined) update.nameCache = nameCache || null;
  if (settings !== undefined) update.settings = settings;
  if (synced) update.logtoSyncedAt = now;

  const [profile] = await db.update(organizationProfiles).set(update).where(eq(organizationProfiles.id, id)).returning();
  return profile;
}

async function markOrganizationProfileLogtoSynced({ id, logtoOrganizationId, nameCache }) {
  return markOrganizationProfileProvisioningStage({
    id,
    logtoOrganizationId,
    nameCache,
    status: LOGTO_SYNC_STATUSES.BOOTSTRAPPED,
    errorMessage: null,
    synced: true,
  });
}

async function markOrganizationProfileLogtoSyncError({ id, errorMessage, status = LOGTO_SYNC_STATUSES.ERROR, settings }) {
  return markOrganizationProfileProvisioningStage({ id, status, errorMessage: errorMessage || "Logto synchronization failed", settings });
}

async function markOrganizationProfileOrphaned({ id, errorMessage, settings }) {
  const now = new Date();
  const [profile] = await db
    .update(organizationProfiles)
    .set({
      status: ORGANIZATION_PROFILE_STATUSES.ORPHANED,
      logtoSyncStatus: LOGTO_SYNC_STATUSES.RECONCILED,
      logtoSyncError: errorMessage || "Logto organization no longer exists; profile retained for audit only",
      settings,
      updatedAt: now,
    })
    .where(eq(organizationProfiles.id, id))
    .returning();
  return profile;
}

async function upsertOrganizationProfile({ logtoOrganizationId, nameCache, type, subdomain, slug, adminDomain, logoUrl, faviconUrl, primaryColor, primaryColorDark, organizationLoginExperienceEnabled = false, defaultRoleNames = [], oidcApplicationId = null, oidcInitialConfig = null, oidcApplicationSecretRef = null, emailDomainProvisioningStatus = "not_requested", settings = null, seatTotal, logtoSyncStatus = LOGTO_SYNC_STATUSES.BOOTSTRAPPED, logtoSyncError = null }) {
  const now = new Date();
  const values = {
    logtoOrganizationId,
    nameCache: nameCache || null,
    type: type || null,
    subdomain: subdomain || null,
    slug: slug || null,
    adminDomain: adminDomain || null,
    logoUrl: logoUrl || null,
    faviconUrl: faviconUrl || null,
    primaryColor: primaryColor || null,
    primaryColorDark: primaryColorDark || null,
    organizationLoginExperienceEnabled: Boolean(organizationLoginExperienceEnabled),
    defaultRoleNames,
    oidcApplicationId: oidcApplicationId || null,
    oidcInitialConfig,
    oidcApplicationSecretRef,
    emailDomainProvisioningStatus,
    settings,
    seatTotal: normalizeSeatTotal(seatTotal),
    logtoSyncStatus,
    logtoSyncError,
    logtoSyncedAt: [LOGTO_SYNC_STATUSES.BOOTSTRAPPED, LOGTO_SYNC_STATUSES.SYNCED].includes(logtoSyncStatus) ? now : null,
    updatedAt: now,
  };

  const [profile] = await db
    .insert(organizationProfiles)
    .values(values)
    .onConflictDoUpdate({
      target: organizationProfiles.logtoOrganizationId,
      set: values,
    })
    .returning();

  return profile;
}

async function markOrganizationProfileFluentCrmSync({ id, companyId = null, status, errorMessage = null, synced = false, settings }) {
  const now = new Date();
  const update = {
    fluentcrmSyncStatus: status,
    fluentcrmSyncError: errorMessage,
    updatedAt: now,
  };

  if (companyId !== undefined) update.fluentcrmCompanyId = companyId;
  if (settings !== undefined) update.settings = settings;
  if (synced) update.fluentcrmSyncedAt = now;

  const [profile] = await db.update(organizationProfiles).set(update).where(eq(organizationProfiles.id, id)).returning();
  return profile;
}

async function findOrganizationProfileBySlugOrAdminDomain({ slug, adminDomain }) {
  const filters = [];
  if (slug) filters.push(eq(organizationProfiles.slug, slug));
  if (adminDomain) filters.push(eq(organizationProfiles.adminDomain, adminDomain));
  if (filters.length === 0) return null;

  const [profile] = await db
    .select()
    .from(organizationProfiles)
    .where(filters.length === 1 ? filters[0] : or(...filters))
    .limit(1);
  return profile || null;
}

async function listOrganizationProfiles() {
  return db.select().from(organizationProfiles);
}

async function getOrganizationProfilesByLogtoIds(logtoOrganizationIds) {
  if (logtoOrganizationIds.length === 0) {
    return new Map();
  }

  const profiles = await db
    .select()
    .from(organizationProfiles)
    .where(inArray(organizationProfiles.logtoOrganizationId, logtoOrganizationIds));

  return new Map(profiles.map((profile) => [profile.logtoOrganizationId, profile]));
}

module.exports = {
  FLUENTCRM_SYNC_STATUSES,
  LOGTO_SYNC_STATUSES,
  ORGANIZATION_PROFILE_STATUSES,
  createOrganizationProfile,
  findOrganizationProfileBySlugOrAdminDomain,
  getOrganizationProfilesByLogtoIds,
  listOrganizationProfiles,
  markOrganizationProfileFluentCrmSync,
  markOrganizationProfileLogtoSyncError,
  markOrganizationProfileLogtoSynced,
  markOrganizationProfileOrphaned,
  markOrganizationProfileProvisioningStage,
  serializeOrganizationProfile,
  upsertOrganizationProfile,
};
