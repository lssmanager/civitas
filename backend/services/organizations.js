const { eq } = require("drizzle-orm");
const { db } = require("../db/client");
const { organizations } = require("../db/schema");

const ORGANIZATION_TYPES = new Set(["school", "district", "community", "other"]);
const ORGANIZATION_STATUSES = new Set(["active", "inactive", "archived"]);

class OrganizationValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "OrganizationValidationError";
    this.status = 400;
    this.details = details;
  }
}

class OrganizationConflictError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "OrganizationConflictError";
    this.status = 409;
    this.field = field;
  }
}

const collapseSpaces = (value) => value.trim().replace(/\s+/g, " ");

const normalizeCreateOrganizationPayload = (payload = {}) => {
  const name = typeof payload.name === "string" ? collapseSpaces(payload.name) : "";
  const type = typeof payload.type === "string" ? payload.type.trim().toLowerCase() : "";
  const subdomain = typeof payload.subdomain === "string" ? payload.subdomain.trim().toLowerCase() : "";
  const seatTotal = Number(payload.seatTotal ?? 0);
  const errors = {};

  if (!name) {
    errors.name = "Organization name is required";
  }

  if (!type) {
    errors.type = "Organization type is required";
  } else if (!ORGANIZATION_TYPES.has(type)) {
    errors.type = "Organization type must be one of: school, district, community, other";
  }

  if (!subdomain) {
    errors.subdomain = "Organization subdomain is required";
  } else if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) {
    errors.subdomain = "Organization subdomain must contain lowercase letters, numbers, or hyphens and cannot start or end with a hyphen";
  }

  if (!Number.isInteger(seatTotal) || seatTotal < 0) {
    errors.seatTotal = "Seat total must be an integer greater than or equal to 0";
  }

  if (Object.keys(errors).length > 0) {
    throw new OrganizationValidationError("Invalid organization payload", errors);
  }

  return {
    name,
    type,
    status: "active",
    subdomain,
    seatTotal,
  };
};

const serializeOrganization = (organization) => ({
  id: organization.id,
  name: organization.name,
  type: organization.type,
  status: organization.status,
  subdomain: organization.subdomain,
  seatTotal: organization.seatTotal,
  createdAt: organization.createdAt?.toISOString?.() ?? organization.createdAt,
  updatedAt: organization.updatedAt?.toISOString?.() ?? organization.updatedAt,
});

async function listOrganizations() {
  const rows = await db.select().from(organizations).orderBy(organizations.createdAt);
  return rows.map(serializeOrganization);
}

async function assertOrganizationIsUnique({ name, subdomain }) {
  const [existingBySubdomain] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.subdomain, subdomain)).limit(1);
  if (existingBySubdomain) {
    throw new OrganizationConflictError("An organization with this subdomain already exists", "subdomain");
  }

  const [existingByName] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.name, name)).limit(1);
  if (existingByName) {
    throw new OrganizationConflictError("An organization with this name already exists", "name");
  }
}

async function createOrganization(payload) {
  const values = normalizeCreateOrganizationPayload(payload);
  await assertOrganizationIsUnique(values);

  try {
    const [organization] = await db.insert(organizations).values(values).returning();
    return serializeOrganization(organization);
  } catch (error) {
    if (error?.code === "23505") {
      const field = error.constraint?.includes("subdomain") ? "subdomain" : "name";
      throw new OrganizationConflictError(`An organization with this ${field} already exists`, field);
    }
    throw error;
  }
}

module.exports = {
  ORGANIZATION_STATUSES,
  ORGANIZATION_TYPES,
  OrganizationConflictError,
  OrganizationValidationError,
  createOrganization,
  listOrganizations,
  normalizeCreateOrganizationPayload,
  serializeOrganization,
};
