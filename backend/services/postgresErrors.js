const POSTGRES_ERROR_NAMES = Object.freeze({
  "42P01": "undefined_table",
  "42703": "undefined_column",
  "23505": "unique_violation",
  "23503": "foreign_key_violation",
});

function getPostgresErrorCode(error = {}) {
  return error.code || error.cause?.code || null;
}

function isSchemaDriftError(error = {}) {
  return ["42P01", "42703"].includes(getPostgresErrorCode(error));
}

function buildSafePostgresErrorDiagnostic(error = {}) {
  const code = getPostgresErrorCode(error);
  return {
    message: error.message,
    code: error.code,
    name: code ? POSTGRES_ERROR_NAMES[code] || null : null,
    cause: error.cause
      ? {
          code: error.cause.code,
          name: POSTGRES_ERROR_NAMES[error.cause.code] || null,
          detail: error.cause.detail,
          table: error.cause.table,
          column: error.cause.column,
          constraint: error.cause.constraint,
          schema: error.cause.schema,
        }
      : undefined,
  };
}

function classifyPostgresOperationalError(error, context = "database operation") {
  if (!isSchemaDriftError(error)) return error;
  const diagnostic = buildSafePostgresErrorDiagnostic(error);
  const classified = new Error(`Database schema drift detected during ${context}. Run npm run migrate before retrying.`);
  classified.name = "DatabaseSchemaDriftError";
  classified.code = "DATABASE_SCHEMA_DRIFT";
  classified.status = 503;
  classified.cause = error;
  classified.diagnostic = diagnostic;
  return classified;
}

module.exports = { POSTGRES_ERROR_NAMES, buildSafePostgresErrorDiagnostic, classifyPostgresOperationalError, getPostgresErrorCode, isSchemaDriftError };
