const { eq, inArray } = require("drizzle-orm");
const { db } = require("../db/client");
const { organizationProfiles } = require("../db/schema");

const LOGTO_SYNC_STATUSES = Object.freeze({
  PENDING: "pending",
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

async function markOrganizationProfileLogtoSynced({ id, logtoOrganizationId, nameCache }) {
  const now = new Date();
  const [profile] = await db
    .update(organizationProfiles)
    .set({
      logtoOrganizationId,
      nameCache: nameCache || null,
      logtoSyncStatus: LOGTO_SYNC_STATUSES.SYNCED,
      logtoSyncError: null,
      logtoSyncedAt: now,
      updatedAt: now,
    })
    .where(eq(organizationProfiles.id, id))
    .returning();

  return profile;
}

async function markOrganizationProfileLogtoSyncError({ id, errorMessage }) {
  const now = new Date();
  const [profile] = await db
    .update(organizationProfiles)
    .set({
      logtoSyncStatus: LOGTO_SYNC_STATUSES.ERROR,
      logtoSyncError: errorMessage || "Logto synchronization failed",
      updatedAt: now,
    })
    .where(eq(organizationProfiles.id, id))
    .returning();

  return profile;
}

async function upsertOrganizationProfile({ logtoOrganizationId, nameCache, type, subdomain, seatTotal }) {
  const now = new Date();
  const values = {
    logtoOrganizationId,
    nameCache: nameCache || null,
    type: type || null,
    subdomain: subdomain || null,
    seatTotal: normalizeSeatTotal(seatTotal),
    logtoSyncStatus: LOGTO_SYNC_STATUSES.SYNCED,
    logtoSyncError: null,
    logtoSyncedAt: now,
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
  serializeOrganizationProfile,
  upsertOrganizationProfile,
};
