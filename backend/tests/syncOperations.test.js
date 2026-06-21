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
