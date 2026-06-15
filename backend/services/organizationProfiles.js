const { eq, inArray } = require("drizzle-orm");
const { db } = require("../db/client");
const { organizationProfiles } = require("../db/schema");

const LOGTO_SYNC_STATUSES = Object.freeze({
  PENDING: "pending",
  LOGTO_CREATED: "logto_created",
  CREATOR_MEMBERSHIP_PENDING: "creator_membership_pending",
  CREATOR_ROLE_PENDING: "creator_role_pending",
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
  seatTotal: profile.seatTotal,
  logtoSyncStatus: profile.logtoSyncStatus,
  logtoSyncError: profile.logtoSyncError,
  logtoSyncedAt: toIso(profile.logtoSyncedAt),
  createdAt: toIso(profile.createdAt),
  updatedAt: toIso(profile.updatedAt),
});

const normalizeSeatTotal = (seatTotal) => {
  const value = Number(seatTotal);
  return Number.isInteger(value) && value >= 0 ? value : 0;
};

async function createOrganizationProfile({ nameCache, type, subdomain, seatTotal }) {
  const now = new Date();
  const [profile] = await db
    .insert(organizationProfiles)
    .values({
      logtoOrganizationId: null,
      nameCache: nameCache || null,
      type: type || null,
      subdomain: subdomain || null,
      seatTotal: normalizeSeatTotal(seatTotal),
      logtoSyncStatus: LOGTO_SYNC_STATUSES.PENDING,
      logtoSyncError: null,
      logtoSyncedAt: null,
      updatedAt: now,
    })
    .returning();

  return profile;
}

async function markOrganizationProfileProvisioningStage({ id, logtoOrganizationId, nameCache, status, errorMessage = null, synced = false }) {
  const now = new Date();
  const update = {
    logtoSyncStatus: status,
    logtoSyncError: errorMessage,
    updatedAt: now,
  };

  if (logtoOrganizationId !== undefined) update.logtoOrganizationId = logtoOrganizationId;
  if (nameCache !== undefined) update.nameCache = nameCache || null;
  if (synced) update.logtoSyncedAt = now;

  const [profile] = await db.update(organizationProfiles).set(update).where(eq(organizationProfiles.id, id)).returning();
  return profile;
}

async function markOrganizationProfileLogtoSynced({ id, logtoOrganizationId, nameCache }) {
  return markOrganizationProfileProvisioningStage({
    id,
    logtoOrganizationId,
    nameCache,
    status: LOGTO_SYNC_STATUSES.SYNCED,
    errorMessage: null,
    synced: true,
  });
}

async function markOrganizationProfileLogtoSyncError({ id, errorMessage, status = LOGTO_SYNC_STATUSES.ERROR }) {
  return markOrganizationProfileProvisioningStage({ id, status, errorMessage: errorMessage || "Logto synchronization failed" });
}

async function upsertOrganizationProfile({ logtoOrganizationId, nameCache, type, subdomain, seatTotal, logtoSyncStatus = LOGTO_SYNC_STATUSES.SYNCED, logtoSyncError = null }) {
  const now = new Date();
  const values = {
    logtoOrganizationId,
    nameCache: nameCache || null,
    type: type || null,
    subdomain: subdomain || null,
    seatTotal: normalizeSeatTotal(seatTotal),
    logtoSyncStatus,
    logtoSyncError,
    logtoSyncedAt: logtoSyncStatus === LOGTO_SYNC_STATUSES.SYNCED ? now : null,
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
  LOGTO_SYNC_STATUSES,
  createOrganizationProfile,
  getOrganizationProfilesByLogtoIds,
  listOrganizationProfiles,
  markOrganizationProfileLogtoSyncError,
  markOrganizationProfileLogtoSynced,
  markOrganizationProfileProvisioningStage,
  serializeOrganizationProfile,
  upsertOrganizationProfile,
};
