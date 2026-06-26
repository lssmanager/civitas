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
