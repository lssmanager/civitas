const { desc } = require("drizzle-orm");
const { db } = require("../db/client");
const { auditLogs } = require("../db/schema");

const DEFAULT_AUDIT_LOG_LIMIT = 25;
const MAX_AUDIT_LOG_LIMIT = 100;
const ALLOWED_RESULTS = new Set(["success", "failure", "denied"]);
const SENSITIVE_KEY_PATTERN = /(token|secret|password|cookie|authorization|api[_-]?key|credential)/i;

function normalizePagination({ limit, offset } = {}) {
  const normalizedLimit = limit === undefined ? DEFAULT_AUDIT_LOG_LIMIT : Number(limit);
  const normalizedOffset = offset === undefined ? 0 : Number(offset);

  if (!Number.isInteger(normalizedLimit) || normalizedLimit < 1) {
    const error = new Error("limit must be a positive integer");
    error.status = 400;
    throw error;
  }

  if (!Number.isInteger(normalizedOffset) || normalizedOffset < 0) {
    const error = new Error("offset must be a non-negative integer");
    error.status = 400;
    throw error;
  }

  return {
    limit: Math.min(normalizedLimit, MAX_AUDIT_LOG_LIMIT),
    offset: normalizedOffset,
  };
}

function sanitizeString(value, maxLength = 500) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function sanitizeMetadataValue(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Error) {
    return sanitizeString(value.message || value.name || "Error");
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeMetadataValue).filter((item) => item !== undefined);
  }

  if (typeof value === "object") {
    return sanitizeMetadata(value);
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  return String(value);
}

function sanitizeMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  return Object.entries(metadata).reduce((safeMetadata, [key, value]) => {
    if (SENSITIVE_KEY_PATTERN.test(key) || value === undefined) {
      return safeMetadata;
    }

    safeMetadata[key] = sanitizeMetadataValue(value);
    return safeMetadata;
  }, {});
}

function serializeAuditLog(row) {
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    organizationId: row.organizationId,
    action: row.action,
    result: row.result,
    metadata: row.metadata || {},
    createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
  };
}

async function recordAuditLog({ actorUserId = null, organizationId = null, action, result, metadata = {} } = {}) {
  try {
    if (!action || typeof action !== "string") {
      throw new Error("Audit action is required");
    }

    if (!ALLOWED_RESULTS.has(result)) {
      throw new Error(`Invalid audit result: ${result}`);
    }

    const [row] = await db
      .insert(auditLogs)
      .values({
        actorUserId,
        organizationId,
        action,
        result,
        metadata: sanitizeMetadata(metadata),
      })
      .returning();

    return serializeAuditLog(row);
  } catch (error) {
    console.error("Failed to record audit log", error);
    return null;
  }
}

async function listAuditLogs({ limit, offset } = {}) {
  const pagination = normalizePagination({ limit, offset });
  const rows = await db
    .select()
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset);

  return {
    auditLogs: rows.map(serializeAuditLog),
    pagination: {
      ...pagination,
      count: rows.length,
    },
  };
}

module.exports = {
  DEFAULT_AUDIT_LOG_LIMIT,
  MAX_AUDIT_LOG_LIMIT,
  listAuditLogs,
  normalizePagination,
  recordAuditLog,
  sanitizeMetadata,
  serializeAuditLog,
};
