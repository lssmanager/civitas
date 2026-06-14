const { eq, inArray } = require("drizzle-orm");
const { db } = require("../db/client");
const { organizationProfiles } = require("../db/schema");
const logtoManagement = require("./logto-management");

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

const getLogtoOrganizationId = (organization) => organization.id || organization.organizationId || organization.logtoOrganizationId;
const getLogtoOrganizationName = (organization) => organization.name || organization.nameCache || null;

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

async function getProfilesByLogtoIds(logtoOrganizationIds) {
  if (logtoOrganizationIds.length === 0) {
    return new Map();
  }

  const profiles = await db
    .select()
    .from(organizationProfiles)
    .where(inArray(organizationProfiles.logtoOrganizationId, logtoOrganizationIds));

  return new Map(profiles.map((profile) => [profile.logtoOrganizationId, profile]));
}

async function listOwnerOrganizations() {
  const logtoOrganizations = await logtoManagement.listOrganizations();
  const items = Array.isArray(logtoOrganizations) ? logtoOrganizations : logtoOrganizations?.data || logtoOrganizations?.items || [];
  const ids = items.map(getLogtoOrganizationId).filter(Boolean);
  const profilesByLogtoId = await getProfilesByLogtoIds(ids);

  return items.map((organization) => {
    const logtoOrganizationId = getLogtoOrganizationId(organization);
    const profile = profilesByLogtoId.get(logtoOrganizationId);

    return {
      logtoOrganizationId,
      name: getLogtoOrganizationName(organization),
      logtoOrganization: organization,
      profile: profile ? serializeOrganizationProfile(profile) : null,
    };
  });
}

async function createOwnerOrganization({ name, description, type, subdomain, seatTotal }) {
  const logtoOrganization = await logtoManagement.createOrganization({ name, description });
  const logtoOrganizationId = getLogtoOrganizationId(logtoOrganization);

  if (!logtoOrganizationId) {
    throw new Error("Logto organization creation response did not include an organization id");
  }

  try {
    const profile = await upsertOrganizationProfile({
      logtoOrganizationId,
      nameCache: getLogtoOrganizationName(logtoOrganization) || name,
      type,
      subdomain,
      seatTotal,
    });

    return {
      logtoOrganizationId,
      logtoOrganization,
      profile: serializeOrganizationProfile(profile),
    };
  } catch (error) {
    error.message = `Logto organization ${logtoOrganizationId} was created, but Civitas metadata persistence failed. Retry safely with the same Logto organization id. ${error.message}`;
    throw error;
  }
}

module.exports = {
  createOwnerOrganization,
  listOwnerOrganizations,
  serializeOrganizationProfile,
  upsertOrganizationProfile,
};
