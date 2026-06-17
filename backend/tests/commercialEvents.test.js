const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");

const { nextCommercialState, normalizeCommercialEventPayload, verifyCommercialWebhookSignature } = require("../services/commercialEvents");

const signed = ({ body, secret, timestamp = Math.floor(Date.now() / 1000) }) => {
  const v1 = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
};

test("commercial webhook rejects invalid authenticity", () => {
  const body = JSON.stringify({ eventId: "evt-1" });
  assert.deepEqual(verifyCommercialWebhookSignature({ rawBody: body, signature: "t=1,v1=bad", secret: "secret", now: Date.now() }).ok, false);
});

test("commercial webhook accepts valid HMAC authenticity", () => {
  const body = JSON.stringify({ eventId: "evt-1" });
  const signature = signed({ body, secret: "secret" });
  assert.equal(verifyCommercialWebhookSignature({ rawBody: body, signature, secret: "secret" }).ok, true);
});

test("commercial payload validation requires idempotency, type, organization resolver and valid seats", () => {
  const result = normalizeCommercialEventPayload({ eventType: "unknown", seatQuantity: -1 });
  assert.equal(result.errors.length, 4);
  assert.deepEqual(result.errors.map((error) => error.field), ["eventId", "eventType", "organization", "seatQuantity"]);
});

test("commercial payload supports canonical contract aliases", () => {
  const result = normalizeCommercialEventPayload({ idempotencyKey: "idem-1", eventType: "purchase_created", logtoOrganizationId: "org-1", product: "pro", paymentStatus: "paid", subscriptionStatus: "active", seatQuantity: 10, timestamp: "2026-06-17T00:00:00.000Z" });
  assert.equal(result.errors.length, 0);
  assert.equal(result.value.eventId, "idem-1");
  assert.equal(result.value.plan, "pro");
  assert.equal(result.value.seatQuantity, 10);
});

test("purchase and seat upgrade update Civitas seat totals and Logto-scoped access state", () => {
  const previous = { seatTotal: 5, settings: { commercial: { plan: "basic" } } };
  const next = nextCommercialState({ event: { eventId: "evt-2", eventType: "subscription_upgraded", plan: "pro", paymentStatus: "paid", subscriptionStatus: "active", seatQuantity: 12 }, previous, consumedSeats: 4 });
  assert.equal(next.seatTotal, 12);
  assert.equal(next.settings.commercial.seatsAvailable, 8);
  assert.equal(next.settings.commercial.accessStatus, "enabled");
  assert.equal(next.settings.commercial.plan, "pro");
});

test("downgrade below consumed seats marks misalignment without destroying memberships", () => {
  const previous = { seatTotal: 10, settings: { commercial: { plan: "pro" } } };
  const next = nextCommercialState({ event: { eventId: "evt-3", eventType: "subscription_downgraded", plan: "basic", seatQuantity: 3 }, previous, consumedSeats: 6 });
  assert.equal(next.seatTotal, 3);
  assert.equal(next.settings.commercial.status, "action_required");
  assert.equal(next.settings.commercial.accessStatus, "pending_review");
  assert.equal(next.settings.commercial.seatMisalignment.reason, "contracted_seats_below_consumed");
});

test("cancellation restricts organization access without global owner role mutation intent", () => {
  const previous = { seatTotal: 4, settings: { commercial: { plan: "pro" } } };
  const next = nextCommercialState({ event: { eventId: "evt-4", eventType: "subscription_cancelled", plan: "pro" }, previous, consumedSeats: 2 });
  assert.equal(next.settings.commercial.status, "cancelled");
  assert.equal(next.settings.commercial.accessStatus, "restricted");
  assert.equal(Object.hasOwn(next.settings.commercial, "owner_global"), false);
});
