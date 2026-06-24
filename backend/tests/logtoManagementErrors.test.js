const assert = require("node:assert/strict");
const test = require("node:test");

const { LogtoManagementApiError } = require("../services/logtoManagement");

test("LogtoManagementApiError exposes only a public-safe body and request shape", () => {
  const error = new LogtoManagementApiError("Logto request failed", {
    status: 502,
    body: {
      reason: "organization_template_missing_roles",
      status: 424,
      timeoutMs: 8000,
      missingRoleNames: ["Admin-org", "Student-org"],
      availableRoleNames: ["Viewer-org"],
      authorization: "Bearer super-secret",
    },
    request: {
      method: "PATCH",
      path: "/organizations/org-1",
      payload: {
        password: "super-secret",
        customData: { apiKey: "hidden" },
      },
    },
    diagnostic: "upstream returned validation details",
  });

  assert.deepEqual(error.body, {
    reason: "organization_template_missing_roles",
    status: 424,
    timeoutMs: 8000,
    missingRoleNames: ["Admin-org", "Student-org"],
  });
  assert.deepEqual(error.request, {
    method: "PATCH",
    path: "/organizations/org-1",
  });
  assert.equal(error.diagnostic, null);
});

test("LogtoManagementApiError keeps redacted internal diagnostics for logs only", () => {
  const error = new LogtoManagementApiError("Logto request failed", {
    status: 502,
    body: {
      authorization: "Bearer super-secret",
      nested: {
        clientSecret: "very-secret",
      },
    },
    request: {
      method: "POST",
      path: "/users",
      payload: {
        password: "Password123!",
        profile: {
          token: "internal-token",
        },
      },
    },
    diagnostic: "retry after fixing connector credentials",
  });

  assert.equal(error.internalBody.authorization, "[Redacted]");
  assert.equal(error.internalBody.nested.clientSecret, "[Redacted]");
  assert.equal(error.internalRequest.payload.password, "[Redacted]");
  assert.equal(error.internalRequest.payload.profile.token, "[Redacted]");
  assert.equal(error.internalDiagnostic, "retry after fixing connector credentials");
});
