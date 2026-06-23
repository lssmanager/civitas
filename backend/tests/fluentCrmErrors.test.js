const assert = require("node:assert/strict");
const test = require("node:test");

const { FluentCrmError } = require("../services/fluentCrm");

test("FluentCrmError exposes only a public-safe body and request shape", () => {
  const error = new FluentCrmError("FluentCRM request failed", {
    status: 422,
    code: "FLUENTCRM_VALIDATION_FAILED",
    body: {
      message: "Validation failed for subscriber payload",
      missing: ["FLUENTCRM_USERNAME"],
      status: 422,
      timeoutMs: 10000,
      errors: {
        email: ["Already exists"],
      },
      authorization: "Basic secret",
    },
    request: {
      method: "POST",
      path: "/subscribers",
      payload: {
        email: "person@example.com",
        password: "super-secret",
      },
    },
    diagnostic: {
      likelyCauses: ["duplicate_email"],
      fieldErrors: {
        email: ["Already exists"],
      },
    },
  });

  assert.deepEqual(error.body, {
    message: "Validation failed for subscriber payload",
    status: 422,
    timeoutMs: 10000,
    missing: ["FLUENTCRM_USERNAME"],
  });
  assert.deepEqual(error.request, {
    method: "POST",
    path: "/subscribers",
  });
  assert.equal(error.diagnostic, null);
});

test("FluentCrmError keeps redacted internal diagnostics for logs only", () => {
  const error = new FluentCrmError("FluentCRM request failed", {
    status: 502,
    body: {
      authorization: "Basic secret",
      nested: {
        apiKey: "private-key",
      },
    },
    request: {
      method: "PUT",
      path: "/subscribers/1",
      payload: {
        app_password: "hidden",
      },
    },
    diagnostic: {
      likelyCauses: ["invalid_application_password"],
      connectorToken: "top-secret",
    },
  });

  assert.equal(error.internalBody.authorization, "[Redacted]");
  assert.equal(error.internalBody.nested.apiKey, "[Redacted]");
  assert.equal(error.internalRequest.payload.app_password, "[Redacted]");
  assert.equal(error.internalDiagnostic.connectorToken, "top-secret");
});
