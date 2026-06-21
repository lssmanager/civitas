const assert = require("node:assert/strict");
const test = require("node:test");
const { buildMicroRequestsForFluentCrmStep, MICRO_REQUEST_STATUSES } = require("../services/organizationBootstrapOperations");

test("bootstrap micro-request builder creates only contact retries for failed contacts", () => {
  const requests = buildMicroRequestsForFluentCrmStep({
    parentOperationId: "op-1",
    logtoOrganizationId: "org-1",
    payloadSnapshot: { crm: { companyName: "Colegio" } },
    fluentCrmStep: {
      status: "created",
      companyId: "company-1",
      administrativeContacts: [
        { key: "ok", email: "ok@school.edu", logtoUserId: "user-ok", contactSync: { status: "created" } },
        { key: "bad", email: "bad@school.edu", logtoUserId: "user-bad", contactSync: { status: "error", reason: "invalid_payload" } },
      ],
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].microRequestType, "retry.crm.contact.sync");
  assert.equal(requests[0].targetEntityId, "user-bad");
  assert.equal(requests[0].status, MICRO_REQUEST_STATUSES.FAILED);
});

test("bootstrap micro-request builder does not create retries for fully resolved FluentCRM step", () => {
  const requests = buildMicroRequestsForFluentCrmStep({
    parentOperationId: "op-1",
    fluentCrmStep: { status: "linked", administrativeContacts: [{ email: "ok@school.edu", contactSync: { status: "updated" } }] },
  });

  assert.deepEqual(requests, []);
});

test("bootstrap micro-request builder creates conflict resolution for company conflicts", () => {
  const requests = buildMicroRequestsForFluentCrmStep({
    parentOperationId: "op-1",
    logtoOrganizationId: "org-1",
    fluentCrmStep: { status: "conflict", reason: "duplicate_domain", message: "Ambiguous FluentCRM company match" },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].microRequestType, "resolve.conflict.crm.company");
  assert.equal(requests[0].status, MICRO_REQUEST_STATUSES.CONFLICT);
});
