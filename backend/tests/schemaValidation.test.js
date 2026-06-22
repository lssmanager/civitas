const assert = require("node:assert/strict");
const test = require("node:test");
const { validateSchemaSnapshot } = require("../db/schemaValidation");

test("schema validation fails when users.logto_user_id is missing", () => {
  const rows = [
    ...["id", "email", "status", "last_login_at", "created_at", "updated_at"].map((column_name) => ({ table_name: "users", column_name })),
    ...["id", "operation_type", "entity_type", "entity_id", "logto_organization_id", "logto_user_id", "status", "canonical_status", "downstream_status", "correlation_id", "idempotency_key", "payload_snapshot_json", "result_snapshot_json", "last_error_json", "retry_count", "started_at", "finished_at", "created_at", "updated_at"].map((column_name) => ({ table_name: "sync_operations", column_name })),
    ...["id", "operation_id", "step_name", "queue_name", "job_id", "attempt", "status", "output_json", "last_error_json", "started_at", "finished_at", "created_at", "updated_at"].map((column_name) => ({ table_name: "sync_operation_steps", column_name })),
  ];
  const result = validateSchemaSnapshot(rows);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingColumns, [{ table: "users", column: "logto_user_id" }]);
});

test("schema validation fails when sync_operations.idempotency_key is missing", () => {
  const rows = [
    ...["id", "logto_user_id", "email", "status", "last_login_at", "created_at", "updated_at"].map((column_name) => ({ table_name: "users", column_name })),
    ...["id", "operation_type", "entity_type", "entity_id", "logto_organization_id", "logto_user_id", "status", "canonical_status", "downstream_status", "correlation_id", "payload_snapshot_json", "result_snapshot_json", "last_error_json", "retry_count", "started_at", "finished_at", "created_at", "updated_at"].map((column_name) => ({ table_name: "sync_operations", column_name })),
    ...["id", "operation_id", "step_name", "queue_name", "job_id", "attempt", "status", "output_json", "last_error_json", "started_at", "finished_at", "created_at", "updated_at"].map((column_name) => ({ table_name: "sync_operation_steps", column_name })),
  ];
  const result = validateSchemaSnapshot(rows);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingColumns, [{ table: "sync_operations", column: "idempotency_key" }]);
});

test("schema validation passes with all critical columns present", () => {
  const required = {
    users: ["id", "logto_user_id", "email", "status", "last_login_at", "created_at", "updated_at"],
    sync_operations: ["id", "operation_type", "entity_type", "entity_id", "logto_organization_id", "logto_user_id", "status", "canonical_status", "downstream_status", "correlation_id", "idempotency_key", "payload_snapshot_json", "result_snapshot_json", "last_error_json", "retry_count", "started_at", "finished_at", "created_at", "updated_at"],
    sync_operation_steps: ["id", "operation_id", "step_name", "queue_name", "job_id", "attempt", "status", "output_json", "last_error_json", "started_at", "finished_at", "created_at", "updated_at"],
  };
  const rows = Object.entries(required).flatMap(([table_name, columns]) => columns.map((column_name) => ({ table_name, column_name })));
  assert.deepEqual(validateSchemaSnapshot(rows), { ok: true, missingTables: [], missingColumns: [] });
});
