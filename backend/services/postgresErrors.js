const POSTGRES_ERROR_NAMES = Object.freeze({
  "42P01": "undefined_table",
  "42703": "undefined_column",
  "23505": "unique_violation",
  "23503": "foreign_key_violation",
  "57014": "query_canceled",
});

function getPostgresErrorCode(error = {}) {
  return error.code || error.cause?.code || null;
}

function isSchemaDriftError(error = {}) {
  return ["42P01", "42703"].includes(getPostgresErrorCode(error));
}

function isConnectionTimeoutError(error = {}) {
  const code = getPostgresErrorCode(error);
  const message = `${error.message || ""} ${error.cause?.message || ""}`.toLowerCase();
  return ["ETIMEDOUT", "ETIMEOUT", "CONNECTION_TIMEOUT"].includes(code) || message.includes("timeout exceeded when trying to connect") || message.includes("connection timeout");
}

function isQueryTimeoutError(error = {}) {
  const code = getPostgresErrorCode(error);
  const message = `${error.message || ""} ${error.cause?.message || ""}`.toLowerCase();
  return code === "57014" || message.includes("query read timeout") || message.includes("statement timeout") || message.includes("canceling statement due to statement timeout");
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

function buildClassifiedPostgresError(error, { code, name, status, message }) {
  const classified = new Error(message);
  classified.name = name;
  classified.code = code;
  classified.status = status;
  classified.cause = error;
  classified.diagnostic = buildSafePostgresErrorDiagnostic(error);
  return classified;
}

function classifyPostgresOperationalError(error, context = "database operation") {
  if (isSchemaDriftError(error)) {
    return buildClassifiedPostgresError(error, {
      code: "DATABASE_SCHEMA_DRIFT",
      name: "DatabaseSchemaDriftError",
      status: 503,
      message: `Database schema drift detected during ${context}. Run npm run migrate before retrying.`,
    });
  }

  if (isConnectionTimeoutError(error)) {
    return buildClassifiedPostgresError(error, {
      code: "DATABASE_CONNECTION_TIMEOUT",
      name: "DatabaseConnectionTimeoutError",
      status: 503,
      message: `Database connection timed out during ${context}.`,
    });
  }

  if (isQueryTimeoutError(error)) {
    return buildClassifiedPostgresError(error, {
      code: "DATABASE_OPERATION_TIMEOUT",
      name: "DatabaseOperationTimeoutError",
      status: 503,
      message: `Database operation timed out during ${context}.`,
    });
  }

  return error;
}

module.exports = {
  POSTGRES_ERROR_NAMES,
  buildSafePostgresErrorDiagnostic,
  classifyPostgresOperationalError,
  getPostgresErrorCode,
  isConnectionTimeoutError,
  isQueryTimeoutError,
  isSchemaDriftError,
};
