const REQUIRED_SCHEMA = Object.freeze({
  users: ["id", "logto_user_id", "email", "status", "last_login_at", "created_at", "updated_at"],
  sync_operations: [
    "id",
    "operation_type",
    "entity_type",
    "entity_id",
    "logto_organization_id",
    "logto_user_id",
    "status",
    "canonical_status",
    "downstream_status",
    "correlation_id",
    "idempotency_key",
    "payload_snapshot_json",
    "result_snapshot_json",
    "last_error_json",
    "retry_count",
    "started_at",
    "finished_at",
    "created_at",
    "updated_at",
  ],
  sync_operation_steps: [
    "id",
    "operation_id",
    "step_name",
    "queue_name",
    "job_id",
    "attempt",
    "status",
    "output_json",
    "last_error_json",
    "started_at",
    "finished_at",
    "created_at",
    "updated_at",
  ],
});

const RECOMMENDED_INDEXES = Object.freeze({
  users: ["users_logto_user_id_unique", "users_email_idx"],
  sync_operations: [
    "sync_operations_idempotency_unique",
    "sync_operations_status_idx",
    "sync_operations_operation_type_idx",
    "sync_operations_logto_org_idx",
    "sync_operations_entity_idx",
    "sync_operations_created_at_idx",
  ],
  sync_operation_steps: [
    "sync_operation_steps_attempt_unique",
    "sync_operation_steps_operation_idx",
    "sync_operation_steps_step_idx",
    "sync_operation_steps_status_idx",
    "sync_operation_steps_job_idx",
  ],
});

class DatabaseSchemaValidationError extends Error {
  constructor(result) {
    const firstMissingTable = result.missingTables[0];
    const firstMissingColumn = result.missingColumns[0];
    const reason = firstMissingTable
      ? `Missing required table ${firstMissingTable}.`
      : `Missing required column ${firstMissingColumn.table}.${firstMissingColumn.column}.`;
    super(`Database schema validation failed. ${reason} Run npm run migrate before starting the server.`);
    this.name = "DatabaseSchemaValidationError";
    this.code = "DATABASE_SCHEMA_VALIDATION_FAILED";
    this.status = 503;
    this.diagnostic = result;
  }
}

function validateSchemaSnapshot(rows, requiredSchema = REQUIRED_SCHEMA) {
  const existing = new Map();
  for (const row of rows || []) {
    if (!existing.has(row.table_name)) existing.set(row.table_name, new Set());
    existing.get(row.table_name).add(row.column_name);
  }

  const missingTables = [];
  const missingColumns = [];

  for (const [table, columns] of Object.entries(requiredSchema)) {
    const tableColumns = existing.get(table);
    if (!tableColumns) {
      missingTables.push(table);
      continue;
    }
    for (const column of columns) {
      if (!tableColumns.has(column)) missingColumns.push({ table, column });
    }
  }

  return { ok: missingTables.length === 0 && missingColumns.length === 0, missingTables, missingColumns };
}

async function validateDatabaseSchema(client) {
  const tables = Object.keys(REQUIRED_SCHEMA);
  const columnsResult = await client.query(
    `select table_name, column_name
       from information_schema.columns
      where table_schema = current_schema()
        and table_name = any($1::text[])`,
    [tables]
  );
  const result = validateSchemaSnapshot(columnsResult.rows);

  const indexResult = await client.query(
    `select tablename as table_name, indexname as index_name
       from pg_indexes
      where schemaname = current_schema()
        and tablename = any($1::text[])`,
    [tables]
  );
  const presentIndexes = new Set(indexResult.rows.map((row) => row.index_name));
  result.missingRecommendedIndexes = Object.entries(RECOMMENDED_INDEXES).flatMap(([table, indexes]) =>
    indexes.filter((indexName) => !presentIndexes.has(indexName)).map((indexName) => ({ table, index: indexName }))
  );

  if (!result.ok) throw new DatabaseSchemaValidationError(result);
  return result;
}

module.exports = { DatabaseSchemaValidationError, REQUIRED_SCHEMA, RECOMMENDED_INDEXES, validateDatabaseSchema, validateSchemaSnapshot };
