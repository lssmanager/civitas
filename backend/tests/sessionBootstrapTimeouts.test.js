const assert = require("node:assert/strict");
const test = require("node:test");

const { classifyPostgresOperationalError } = require("../services/postgresErrors");
const { withTimeout } = require("../services/timeouts");

test("withTimeout rejects even when the wrapped operation ignores AbortSignal", async () => {
  await assert.rejects(
    () => withTimeout(() => new Promise(() => {}), {
      timeoutMs: 10,
      label: "session bootstrap",
      code: "SESSION_INTERNAL_USER_TIMEOUT",
      name: "SessionInternalUserTimeoutError",
      status: 503,
    }),
    (error) => {
      assert.equal(error.name, "SessionInternalUserTimeoutError");
      assert.equal(error.code, "SESSION_INTERNAL_USER_TIMEOUT");
      assert.equal(error.status, 503);
      assert.equal(error.timeoutMs, 10);
      return true;
    },
  );
});

test("classifyPostgresOperationalError maps pool connection timeouts to 503", () => {
  const classified = classifyPostgresOperationalError(new Error("timeout exceeded when trying to connect"), "/api/me internal user projection");

  assert.equal(classified.name, "DatabaseConnectionTimeoutError");
  assert.equal(classified.code, "DATABASE_CONNECTION_TIMEOUT");
  assert.equal(classified.status, 503);
});

test("classifyPostgresOperationalError maps PostgreSQL statement timeouts to 503", () => {
  const error = new Error("canceling statement due to statement timeout");
  error.code = "57014";

  const classified = classifyPostgresOperationalError(error, "/api/me internal user projection");

  assert.equal(classified.name, "DatabaseOperationTimeoutError");
  assert.equal(classified.code, "DATABASE_OPERATION_TIMEOUT");
  assert.equal(classified.status, 503);
});
