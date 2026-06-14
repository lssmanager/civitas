const { inArray } = require("drizzle-orm");
const { db } = require("../db/client");
const { organizationProfiles } = require("../db/schema");

const serializeOrganizationProfile = (profile) => ({
  id: profile.id,
  logtoOrganizationId: profile.logtoOrganizationId,
  nameCache: profile.nameCache,
  type: profile.type,
  status: profile.status,
  subdomain: profile.subdomain,
  seatTotal: profile.seatTotal,
  createdAt: profile.createdAt?.toISOString?.() ?? profile.createdAt,
  updatedAt: profile.updatedAt?.toISOString?.() ?? profile.updatedAt,
});

async function upsertOrganizationProfile({ logtoOrganizationId, nameCache, type, subdomain, seatTotal }) {
  const now = new Date();
  const values = {
    logtoOrganizationId,
    nameCache: nameCache || null,
    type: type || null,
    subdomain: subdomain || null,
    seatTotal: Number.isInteger(seatTotal) ? seatTotal : 0,
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
  getOrganizationProfilesByLogtoIds,
  serializeOrganizationProfile,
  upsertOrganizationProfile,
};
