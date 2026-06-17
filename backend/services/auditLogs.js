const { count, desc, eq } = require("drizzle-orm");
const { db } = require("../db/client");
const { auditLogs, users } = require("../db/schema");

const AUDIT_RESULTS = Object.freeze({
  SUCCESS: "success",
  ERROR: "error",
  DENIED: "denied",
});

const AUDIT_ACTIONS = Object.freeze({
  OWNER_ORGANIZATION_PROFILE_CREATE: "owner.organization.profile_create",
  OWNER_ORGANIZATION_TEMPLATE_VALIDATE: "owner.organization.template_validate",
  OWNER_ORGANIZATION_LOGTO_CREATE: "owner.organization.logto_create",
  OWNER_ORGANIZATION_METADATA_RECONCILE: "owner.organization.metadata_reconcile",
  OWNER_ORGANIZATION_BASE_MEMBER: "owner.organization.base_member",
  OWNER_ORGANIZATION_BASE_ROLE: "owner.organization.base_role",
  OWNER_ORGANIZATION_BASE_GLOBAL_ROLES: "owner.organization.base_global_roles",
  OWNER_ORGANIZATION_CREATOR_MEMBERSHIP: "owner.organization.creator_membership",
  OWNER_ORGANIZATION_CREATOR_ROLE: "owner.organization.creator_role",
  OWNER_ORGANIZATION_BOOTSTRAP_FAILED: "owner.organization.bootstrap_failed",
  OWNER_ORGANIZATION_PROVISIONING: "owner.organization.provisioning",
});

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_OFFSET = 5000;
const ALLOWED_AUDIT_ACTIONS = new Set(Object.values(AUDIT_ACTIONS));
const ALLOWED_AUDIT_RESULTS = new Set(Object.values(AUDIT_RESULTS));
const SENSITIVE_KEY_PATTERN = /(authorization|token|secret|password|credential|cookie|api[_-]?key)/i;

const toIso = (value) => value?.toISOString?.() ?? value;

function sanitizeMetadata(value, depth = 0) {
  if (value == null) return null;
  if (depth > 4) return "[MaxDepth]";

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeMetadata(item, depth + 1));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      status: value.status,
    };
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? "[Redacted]" : sanitizeMetadata(entryValue, depth + 1),
      ])
    );
  }

  if (typeof value === "string") {
    return value.length > 1000 ? `${value.slice(0, 1000)}…` : value;
  }

  return value;
}

function normalizePagination({ limit, offset } = {}) {
  const parsedLimit = Number.parseInt(limit, 10);
  const parsedOffset = Number.parseInt(offset, 10);

  return {
    limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, MAX_LIMIT) : DEFAULT_LIMIT,
    offset: Number.isFinite(parsedOffset) && parsedOffset >= 0 ? Math.min(parsedOffset, MAX_OFFSET) : 0,
  };
}

const getMetadataValue = (metadata, key) => metadata && typeof metadata === "object" ? metadata[key] : null;

const buildActorSnapshot = ({ log, actor }) => {
  const metadataActor = getMetadataValue(log.metadata, "actor");
  return {
    internalUserId: log.actorUserId,
    logtoUserId: getMetadataValue(metadataActor, "logtoUserId") || actor?.logtoUserId || null,
    email: getMetadataValue(metadataActor, "email") || actor?.email || null,
    displayName: getMetadataValue(metadataActor, "displayName") || getMetadataValue(metadataActor, "username") || actor?.email || actor?.logtoUserId || null,
  };
};

const buildOrganizationSnapshot = ({ log, organizationNamesById = new Map() }) => {
  const metadataOrganization = getMetadataValue(log.metadata, "organization");
  const organizationId = log.organizationId;
  return {
    id: organizationId,
    name: getMetadataValue(metadataOrganization, "name") || (organizationId ? organizationNamesById.get(organizationId) : null) || null,
  };
};

const serializeAuditLog = (row, { organizationNamesById = new Map() } = {}) => {
  const log = row.auditLog || row;
  const actor = row.actor || null;

  return {
    id: log.id,
    actorUserId: log.actorUserId,
    actor: buildActorSnapshot({ log, actor }),
    organizationId: log.organizationId,
    organization: buildOrganizationSnapshot({ log, organizationNamesById }),
    action: log.action,
    result: log.result,
    metadata: log.metadata,
    createdAt: toIso(log.createdAt),
  };
};

async function recordAuditLog({ actorUserId = null, organizationId = null, action, result, metadata = null }) {
  if (!ALLOWED_AUDIT_ACTIONS.has(action)) {
    throw new Error(`Invalid audit action: ${action}`);
  }

  if (!ALLOWED_AUDIT_RESULTS.has(result)) {
    throw new Error(`Invalid audit result: ${result}`);
  }

  const [log] = await db
    .insert(auditLogs)
    .values({
      actorUserId,
      organizationId,
      action,
      result,
      metadata: sanitizeMetadata(metadata),
    })
    .returning();

  return log;
}

async function recordAuditLogBestEffort(event) {
  try {
    return await recordAuditLog(event);
  } catch (error) {
    console.error("Failed to write audit log", error);
    return null;
  }
}

async function listAuditLogs(paginationInput = {}, enrichment = {}) {
  const pagination = normalizePagination(paginationInput);
  const [totalRow] = await db.select({ value: count() }).from(auditLogs);
  const rows = await db
    .select({ auditLog: auditLogs, actor: users })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorUserId, users.id))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(pagination.limit)
    .offset(pagination.offset);

  return {
    auditLogs: rows.map((row) => serializeAuditLog(row, enrichment)),
    pagination: {
      ...pagination,
      total: Number(totalRow?.value ?? 0),
    },
  };
}

module.exports = {
  AUDIT_ACTIONS,
  AUDIT_RESULTS,
  listAuditLogs,
  normalizePagination,
  recordAuditLog,
  recordAuditLogBestEffort,
  sanitizeMetadata,
  serializeAuditLog,
};
