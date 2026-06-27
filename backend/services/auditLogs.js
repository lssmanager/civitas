const { desc, eq } = require("drizzle-orm");
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
  OWNER_ORGANIZATION_FLUENTCRM_LINK: "owner.organization.fluentcrm_link",
  OWNER_ORGANIZATION_FLUENTCRM_SYNC: "owner.organization.fluentcrm_sync",
  OWNER_ORGANIZATION_FLUENTCRM_CONFLICT: "owner.organization.fluentcrm_conflict",
  OWNER_ORGANIZATION_FLUENTCRM_ERROR: "owner.organization.fluentcrm_error",
  OWNER_ORGANIZATION_DIRECTORY_ACCESS: "owner.organization.directory_access",
  OWNER_ORGANIZATION_FLUENTCRM_CONTACT_SYNC: "owner.organization.fluentcrm_contact_sync",
  OWNER_ORGANIZATION_MEMBER_DEPROVISION_REQUEST: "owner.organization.member_deprovision_request",
  OWNER_ORGANIZATION_MEMBER_DEPROVISION_LOGTO: "owner.organization.member_deprovision_logto",
  OWNER_ORGANIZATION_MEMBER_DEPROVISION_FLUENTCRM: "owner.organization.member_deprovision_fluentcrm",
  OWNER_FLUENTCRM_ROLE_MAPPING_UPDATE: "owner.fluentcrm.role_mapping.update",
  OWNER_FLUENTCRM_ROLE_MAPPING_RESET: "owner.fluentcrm.role_mapping.reset",
  OWNER_WORDPRESS_ROLE_MAPPING_UPDATE: "owner.wordpress.role_mapping.update",
  OWNER_WORDPRESS_ROLE_MAPPING_RESET: "owner.wordpress.role_mapping.reset",
  COMMERCIAL_EVENT_RECEIVED: "commercial.event.received",
  COMMERCIAL_EVENT_APPLIED: "commercial.event.applied",
  COMMERCIAL_EVENT_FAILED: "commercial.event.failed",
  COMMERCIAL_EVENT_IGNORED: "commercial.event.ignored",
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
  const filters = {
    organizationId: paginationInput.organizationId,
    organizationName: paginationInput.organizationName,
    entityType: paginationInput.entityType,
    stepName: paginationInput.stepName,
    affectedSystem: paginationInput.affectedSystem,
    status: paginationInput.status,
    retryState: paginationInput.retryState,
    requiresAction: paginationInput.requiresAction,
    retryable: paginationInput.retryable,
    requiresHumanAction: paginationInput.requiresHumanAction,
    downstream: paginationInput.downstream,
    system: paginationInput.system,
    microAction: paginationInput.microAction,
    queueName: paginationInput.queueName,
    q: paginationInput.q,
  };
  const allRows = await db
    .select({ auditLog: auditLogs, actor: users })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorUserId, users.id))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(1000);

  const matches = (row) => {
    const log = row.auditLog || row;
    const metadata = log.metadata || {};
    const organizationName = log.organizationId ? enrichment.organizationNamesById?.get?.(log.organizationId) : null;
    const includes = (value, expected) => !expected || String(value || "").toLowerCase().includes(String(expected).toLowerCase());
    if (!includes(log.organizationId, filters.organizationId)) return false;
    if (!includes(organizationName, filters.organizationName)) return false;
    if (!includes(metadata.entityType, filters.entityType)) return false;
    if (!includes(metadata.stepName, filters.stepName)) return false;
    if (!includes(metadata.affectedSystem || metadata.system, filters.affectedSystem || filters.system)) return false;
    if (!includes(metadata.queueName, filters.queueName)) return false;
    if (filters.microAction && !includes([metadata.microAction, metadata.stepName, metadata.humanMessage, log.action].filter(Boolean).join(" "), filters.microAction)) return false;
    if (filters.q && !includes([metadata.humanMessage, metadata.stepName, metadata.entityType, metadata.targetIdentity, metadata.providerCode, log.action, organizationName].filter(Boolean).join(" "), filters.q)) return false;
    if (!includes(log.result, filters.status) && !includes(metadata.status || metadata.providerStatus, filters.status)) return false;
    if (!includes(metadata.retryState, filters.retryState)) return false;
    if (filters.retryable === "true" && !metadata.retryable) return false;
    if (filters.retryable === "false" && metadata.retryable) return false;
    if (filters.requiresHumanAction === "true" && !metadata.requiresHumanAction) return false;
    if (filters.requiresHumanAction === "false" && metadata.requiresHumanAction) return false;
    if (filters.downstream === "true" && !/fluentcrm|wordpress|branding|downstream|sync/i.test(String(metadata.entityType || metadata.stepName || metadata.affectedSystem || metadata.system || log.action || ""))) return false;
    if (filters.requiresAction === "true" && !(log.result === AUDIT_RESULTS.ERROR || metadata.requiresAction || metadata.requiresHumanAction || metadata.retryable)) return false;
    if (filters.requiresAction === "false" && (log.result === AUDIT_RESULTS.ERROR || metadata.requiresAction || metadata.requiresHumanAction || metadata.retryable)) return false;
    return true;
  };
  const filteredRows = allRows.filter(matches);
  const rows = filteredRows.slice(pagination.offset, pagination.offset + pagination.limit);

  return {
    auditLogs: rows.map((row) => serializeAuditLog(row, enrichment)),
    pagination: {
      ...pagination,
      total: filteredRows.length,
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
