const crypto = require("node:crypto");
const { desc, eq, or } = require("drizzle-orm");
const { db } = require("../db/client");
const { commercialEvents, organizationProfiles } = require("../db/schema");
const { listLogtoOrganizationUsers, updateLogtoOrganizationCustomData } = require("./logtoManagement");
const { AUDIT_ACTIONS, AUDIT_RESULTS, recordAuditLogBestEffort } = require("./auditLogs");

const EVENT_STATUSES = Object.freeze({ RECEIVED: "received", VALIDATED: "validated", APPLIED: "applied", IGNORED: "ignored", FAILED: "failed" });
const COMMERCIAL_STATUSES = Object.freeze({ ACTIVE: "active", PAST_DUE: "past_due", CANCELLED: "cancelled", REFUNDED: "refunded", PENDING: "pending", ACTION_REQUIRED: "action_required" });
const ACCESS_STATUSES = Object.freeze({ ENABLED: "enabled", RESTRICTED: "restricted", PENDING_REVIEW: "pending_review" });
const SUPPORTED_EVENT_TYPES = new Set(["purchase_created", "payment_succeeded", "subscription_renewed", "subscription_upgraded", "subscription_downgraded", "subscription_cancelled", "payment_failed", "refund_applied", "seat_change"]);
const ACCESS_RESTRICTING_EVENTS = new Set(["subscription_cancelled", "payment_failed", "refund_applied"]);

const normalizeString = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const sha256Json = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const safeError = (error) => error?.message ? error.message.slice(0, 500) : "Unknown commercial event error";

function verifyCommercialWebhookSignature({ rawBody, signature, secret, toleranceSeconds = 300, now = Date.now() }) {
  if (!secret) return { ok: false, reason: "webhook_secret_not_configured" };
  if (!signature) return { ok: false, reason: "missing_signature" };
  const parts = Object.fromEntries(String(signature).split(",").map((part) => part.split("=").map((v) => v.trim())));
  const timestamp = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(timestamp) || !v1) return { ok: false, reason: "malformed_signature" };
  if (Math.abs(Math.floor(now / 1000) - timestamp) > toleranceSeconds) return { ok: false, reason: "stale_signature" };
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const actual = Buffer.from(v1, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer) ? { ok: true } : { ok: false, reason: "signature_mismatch" };
}

function normalizeCommercialEventPayload(payload = {}) {
  const eventId = normalizeString(payload.eventId) || normalizeString(payload.idempotencyKey);
  const eventType = normalizeString(payload.eventType);
  const logtoOrganizationId = normalizeString(payload.logtoOrganizationId);
  const organizationId = normalizeString(payload.organizationId);
  const companyId = normalizeString(payload.companyId) || normalizeString(payload.fluentcrm_company_id);
  const seatQuantity = payload.seatQuantity === undefined || payload.seatQuantity === null ? null : Number(payload.seatQuantity);
  const occurredAt = normalizeString(payload.timestamp) || new Date().toISOString();
  const errors = [];
  if (!eventId) errors.push({ field: "eventId", message: "eventId or idempotencyKey is required" });
  if (!eventType || !SUPPORTED_EVENT_TYPES.has(eventType)) errors.push({ field: "eventType", message: "Unsupported commercial event type" });
  if (!logtoOrganizationId && !organizationId && !companyId) errors.push({ field: "organization", message: "logtoOrganizationId, organizationId, or companyId is required" });
  if (seatQuantity !== null && (!Number.isInteger(seatQuantity) || seatQuantity < 0)) errors.push({ field: "seatQuantity", message: "seatQuantity must be a non-negative integer" });
  if (Number.isNaN(Date.parse(occurredAt))) errors.push({ field: "timestamp", message: "timestamp must be an ISO date" });
  return { errors, value: { eventId, eventType, logtoOrganizationId, organizationId, companyId, plan: normalizeString(payload.plan) || normalizeString(payload.product), paymentStatus: normalizeString(payload.paymentStatus), subscriptionStatus: normalizeString(payload.subscriptionStatus), seatQuantity, occurredAt: new Date(occurredAt), metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {} } };
}

async function resolveCommercialOrganization(event) {
  const filters = [];
  if (event.logtoOrganizationId) filters.push(eq(organizationProfiles.logtoOrganizationId, event.logtoOrganizationId));
  if (event.organizationId) filters.push(eq(organizationProfiles.id, event.organizationId), eq(organizationProfiles.logtoOrganizationId, event.organizationId));
  if (event.companyId) filters.push(eq(organizationProfiles.fluentcrmCompanyId, event.companyId));
  if (!filters.length) return { status: "missing" };
  const matches = await db.select().from(organizationProfiles).where(or(...filters));
  const unique = [...new Map(matches.map((profile) => [profile.id, profile])).values()];
  if (unique.length !== 1 || !unique[0].logtoOrganizationId) return { status: unique.length > 1 ? "conflict" : "missing", matches: unique };
  return { status: "resolved", profile: unique[0] };
}

async function countConsumedSeats(logtoOrganizationId) {
  const users = await listLogtoOrganizationUsers({ organizationId: logtoOrganizationId });
  return users.length;
}

function nextCommercialState({ event, previous, consumedSeats }) {
  const now = new Date().toISOString();
  const current = previous.settings?.commercial || {};
  const requestedSeatTotal = event.seatQuantity ?? previous.seatTotal;
  const overCapacity = requestedSeatTotal < consumedSeats;
  const accessStatus = ACCESS_RESTRICTING_EVENTS.has(event.eventType) ? ACCESS_STATUSES.RESTRICTED : overCapacity ? ACCESS_STATUSES.PENDING_REVIEW : ACCESS_STATUSES.ENABLED;
  const commercialStatus = event.eventType === "payment_failed" ? COMMERCIAL_STATUSES.PAST_DUE : event.eventType === "subscription_cancelled" ? COMMERCIAL_STATUSES.CANCELLED : event.eventType === "refund_applied" ? COMMERCIAL_STATUSES.REFUNDED : overCapacity ? COMMERCIAL_STATUSES.ACTION_REQUIRED : COMMERCIAL_STATUSES.ACTIVE;
  return { seatTotal: requestedSeatTotal, settings: { ...(previous.settings || {}), commercial: { ...current, plan: event.plan || current.plan || null, product: event.plan || current.product || null, status: commercialStatus, paymentStatus: event.paymentStatus || current.paymentStatus || null, subscriptionStatus: event.subscriptionStatus || current.subscriptionStatus || null, accessStatus, seatTotal: requestedSeatTotal, seatsConsumed: consumedSeats, seatsAvailable: Math.max(requestedSeatTotal - consumedSeats, 0), seatMisalignment: overCapacity ? { reason: "contracted_seats_below_consumed", contracted: requestedSeatTotal, consumed: consumedSeats, detectedAt: now } : null, lastEventId: event.eventId, lastEventType: event.eventType, lastEventAppliedAt: now, lastError: null, persistencePolicy: "operational_commercial_state_only_no_crm_replica" } } };
}

async function applyCommercialEvent(normalized, row) {
  const resolution = await resolveCommercialOrganization(normalized);
  if (resolution.status !== "resolved") throw Object.assign(new Error(`Commercial organization resolution ${resolution.status}`), { code: `COMMERCIAL_ORG_${resolution.status.toUpperCase()}` });
  const profile = resolution.profile;
  const consumedSeats = await countConsumedSeats(profile.logtoOrganizationId);
  const next = nextCommercialState({ event: normalized, previous: profile, consumedSeats });
  const [updated] = await db.update(organizationProfiles).set({ seatTotal: next.seatTotal, settings: next.settings, updatedAt: new Date() }).where(eq(organizationProfiles.id, profile.id)).returning();
  await updateLogtoOrganizationCustomData({ organizationId: profile.logtoOrganizationId, customData: { civitasCommercial: { accessStatus: next.settings.commercial.accessStatus, plan: next.settings.commercial.plan, source: "civitas_commercial_webhook", lastEventId: normalized.eventId } } });
  await db.update(commercialEvents).set({ status: EVENT_STATUSES.APPLIED, organizationProfileId: profile.id, logtoOrganizationId: profile.logtoOrganizationId, seatDelta: next.seatTotal - profile.seatTotal, commercialStatusAfter: next.settings.commercial.status, logtoChangeSummary: { customData: "civitasCommercial", untouched: ["global_roles", "owner_global", "memberships"] }, appliedAt: new Date(), updatedAt: new Date() }).where(eq(commercialEvents.id, row.id));
  await recordAuditLogBestEffort({ organizationId: profile.logtoOrganizationId, action: AUDIT_ACTIONS.COMMERCIAL_EVENT_APPLIED, result: AUDIT_RESULTS.SUCCESS, metadata: { eventId: normalized.eventId, eventType: normalized.eventType, seatTotal: next.seatTotal, consumedSeats, accessStatus: next.settings.commercial.accessStatus, logtoChange: "organization_custom_data_only_no_global_roles" } });
  return { status: "applied", organizationId: profile.logtoOrganizationId, commercial: next.settings.commercial, profile: updated };
}

async function processCommercialEvent(payload) {
  const normalizedInput = normalizeCommercialEventPayload(payload);
  if (normalizedInput.errors.length) {
    await recordAuditLogBestEffort({ action: AUDIT_ACTIONS.COMMERCIAL_EVENT_FAILED, result: AUDIT_RESULTS.ERROR, metadata: { stage: "payload_validation", errors: normalizedInput.errors } });
    return { status: "invalid", errors: normalizedInput.errors };
  }
  const event = normalizedInput.value;
  const payloadHash = sha256Json(payload);
  let [row] = await db.select().from(commercialEvents).where(eq(commercialEvents.eventId, event.eventId)).limit(1);
  if (row) {
    if (row.payloadHash !== payloadHash) {
      await db.update(commercialEvents).set({ status: EVENT_STATUSES.FAILED, errorSummary: "Duplicate eventId received with a different payload", updatedAt: new Date() }).where(eq(commercialEvents.id, row.id));
      return { status: "failed", duplicate: true, reason: "payload_hash_mismatch" };
    }
    if ([EVENT_STATUSES.APPLIED, EVENT_STATUSES.IGNORED].includes(row.status)) return { status: "ignored", duplicate: true, previousStatus: row.status };
  } else {
    [row] = await db.insert(commercialEvents).values({ eventId: event.eventId, idempotencyKey: event.eventId, payloadHash, eventType: event.eventType, source: "wordpress_fluentcrm", status: EVENT_STATUSES.RECEIVED, receivedAt: new Date(), occurredAt: event.occurredAt, sanitizedPayload: { eventType: event.eventType, plan: event.plan, paymentStatus: event.paymentStatus, subscriptionStatus: event.subscriptionStatus, seatQuantity: event.seatQuantity, companyId: event.companyId, logtoOrganizationId: event.logtoOrganizationId } }).returning();
    await recordAuditLogBestEffort({ action: AUDIT_ACTIONS.COMMERCIAL_EVENT_RECEIVED, result: AUDIT_RESULTS.SUCCESS, metadata: { eventId: event.eventId, eventType: event.eventType } });
  }
  await db.update(commercialEvents).set({ status: EVENT_STATUSES.VALIDATED, updatedAt: new Date() }).where(eq(commercialEvents.id, row.id));
  try { return await applyCommercialEvent(event, row); } catch (error) {
    await db.update(commercialEvents).set({ status: EVENT_STATUSES.FAILED, errorSummary: safeError(error), updatedAt: new Date() }).where(eq(commercialEvents.id, row.id));
    await recordAuditLogBestEffort({ action: AUDIT_ACTIONS.COMMERCIAL_EVENT_FAILED, result: AUDIT_RESULTS.ERROR, metadata: { eventId: event.eventId, eventType: event.eventType, error: safeError(error), code: error.code } });
    return { status: "failed", error: safeError(error), code: error.code };
  }
}

async function getCommercialStatusForOrganization(organizationId) {
  const [profile] = await db.select().from(organizationProfiles).where(or(eq(organizationProfiles.id, organizationId), eq(organizationProfiles.logtoOrganizationId, organizationId))).limit(1);
  if (!profile) return null;
  const consumedSeats = profile.logtoOrganizationId ? await countConsumedSeats(profile.logtoOrganizationId).catch(() => profile.settings?.commercial?.seatsConsumed ?? 0) : 0;
  return { organizationId: profile.logtoOrganizationId, profileId: profile.id, seatTotal: profile.seatTotal, seatsConsumed: consumedSeats, seatsAvailable: Math.max(profile.seatTotal - consumedSeats, 0), commercial: profile.settings?.commercial || null };
}

async function getLatestCommercialEventsForOrganization(organizationId, limit = 5) {
  return db.select().from(commercialEvents).where(or(eq(commercialEvents.organizationProfileId, organizationId), eq(commercialEvents.logtoOrganizationId, organizationId))).orderBy(desc(commercialEvents.receivedAt)).limit(limit);
}

module.exports = { ACCESS_STATUSES, COMMERCIAL_STATUSES, EVENT_STATUSES, normalizeCommercialEventPayload, processCommercialEvent, verifyCommercialWebhookSignature, getCommercialStatusForOrganization, getLatestCommercialEventsForOrganization, nextCommercialState };
