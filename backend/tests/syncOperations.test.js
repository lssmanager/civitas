const test = require("node:test");
const assert = require("node:assert/strict");
const { safeFunctionalMessage } = require("../services/syncOperations");

test("safeFunctionalMessage hides legacy SQL and micro-request table names", () => {
  assert.equal(
    safeFunctionalMessage('Failed query: select * from organization_bootstrap_micro_requests where id = $1', 'No se pudo cargar pendientes.'),
    'No se pudo cargar pendientes.'
  );
});

test("safeFunctionalMessage keeps functional downstream errors", () => {
  assert.equal(
    safeFunctionalMessage('No se pudo sincronizar el contacto administrativo con FluentCRM'),
    'No se pudo sincronizar el contacto administrativo con FluentCRM'
  );
});

test("serializePending projects field-level step diagnostics", () => {
  const { serializePending } = require("../services/syncOperations");
  const item = serializePending({
    id: "op-1",
    operationType: "organization_profile_downstream_sync",
    entityType: "organization",
    logtoOrganizationId: "org-1",
    status: "partial_failed",
    steps: [{ outputJson: { result: { entityType: "company", targetIdentity: { companyName: "Colegio Demo" }, fieldsSent: ["website"], missingFields: ["company_id"], fieldDiffs: { website: { before: "old", after: "new" } }, providerStatus: "error", providerCode: "FLUENTCRM_VALIDATION_FAILED", humanMessage: "Company: rechazado website" } }, lastErrorJson: { message: "Company: rechazado website", retryable: false } }],
  });

  assert.equal(item.entityType, "company");
  assert.deepEqual(item.fieldsSent, ["website"]);
  assert.deepEqual(item.missingFields, ["company_id"]);
  assert.equal(item.providerCode, "FLUENTCRM_VALIDATION_FAILED");
  assert.equal(item.humanMessage, "Company: rechazado website");
});

test("serializePending reports queued retry and FluentCRM company creation need", () => {
  const { serializePending } = require("../services/syncOperations");
  const item = serializePending({
    id: "op-company",
    operationType: "organization_profile_downstream_sync",
    entityType: "organization",
    logtoOrganizationId: "org-1",
    status: "queued",
    retryCount: 1,
    steps: [{ stepName: "fluentcrm.company.ensure", queueName: "sync", jobId: "job-1", status: "queued", outputJson: { result: { entityType: "company", targetIdentity: { companyName: "Colegio Demo" }, providerCode: "missing_company_id", fieldsSent: ["companyName", "state"], missingFields: ["city", "postal_code"] } } }],
  });

  assert.equal(item.type, "FluentCRM company");
  assert.equal(item.stepName, "fluentcrm.company.ensure");
  assert.equal(item.retryState, "queued");
  assert.equal(item.humanMessage, "Reintento solicitado; job en cola");
  assert.equal(item.queueName, "sync");
  assert.equal(item.jobId, "job-1");
});

test("serializePending derives actionable missing-field and duplicate-contact messages", () => {
  const { serializePending } = require("../services/syncOperations");
  const company = serializePending({ id: "op-fields", operationType: "organization_profile_downstream_sync", status: "partial_failed", steps: [{ stepName: "fluentcrm.company.patch", status: "failed", outputJson: { result: { entityType: "company", missingFields: ["state", "city", "postal_code"], providerStatus: "validation_error" } } }] });
  const contact = serializePending({ id: "op-contact", operationType: "member_identity_downstream_sync", status: "partial_failed", steps: [{ stepName: "fluentcrm.contact.upsert:recepcion@example.edu", status: "failed", outputJson: { result: { entityType: "contact", targetIdentity: { email: "recepcion@example.edu" }, providerCode: "FLUENTCRM_DUPLICATE_CONTACT" } } }] });

  assert.equal(company.humanMessage, "Falta sincronizar state, city y postal_code");
  assert.equal(contact.type, "FluentCRM contact");
  assert.equal(contact.humanMessage, "FluentCRM rechazó el contacto por email duplicado");
});
