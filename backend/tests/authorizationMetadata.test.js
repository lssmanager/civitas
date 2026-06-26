const assert = require("node:assert/strict");
const test = require("node:test");
const { buildAuthorizationMetadata, normalizeStringList } = require("../services/authorizationMetadata");

test("buildAuthorizationMetadata derives RBAC metadata only from access token claims", () => {
  const metadata = buildAuthorizationMetadata({
    sub: "user-1",
    scopes: ["owner:read", "owner:write"],
    globalRoles: ["owner_global"],
    organizationRoles: [],
    organizationId: null,
    claims: { iss: "https://issuer", aud: "api", iat: 1, exp: 2 },
  });

  assert.equal(metadata.sub, "user-1");
  assert.equal(metadata.issuer, "https://issuer");
  assert.equal(metadata.audience, "api");
  assert.deepEqual(metadata.scopes, ["owner:read", "owner:write"]);
  assert.deepEqual(metadata.globalRoles, ["owner_global"]);
  assert.deepEqual(metadata.organizationRoles, []);
  assert.equal(metadata.organizationId, null);
  assert.equal(metadata.owner.canReadOwner, true);
  assert.equal(metadata.owner.canWriteOwner, true);
  assert.equal(metadata.token.issuedAt, "1970-01-01T00:00:01.000Z");
  assert.equal(metadata.token.expiresAt, "1970-01-01T00:00:02.000Z");
});

test("buildAuthorizationMetadata keeps owner global separate from organization tokens", () => {
  const metadata = buildAuthorizationMetadata({
    sub: "user-2",
    scopes: ["owner:read", "owner:write"],
    globalRoles: ["owner_global"],
    organizationRoles: ["Admin-org"],
    organizationId: "org-1",
    claims: { iss: "https://issuer", aud: ["api", "urn:logto:organization:org-1"] },
  });

  assert.equal(metadata.organizationId, "org-1");
  assert.equal(metadata.owner.canReadOwner, false);
  assert.equal(metadata.owner.canWriteOwner, false);
  assert.deepEqual(metadata.roles, ["owner_global", "Admin-org"]);
});

test("normalizeStringList deduplicates strings without inventing scopes", () => {
  assert.deepEqual(normalizeStringList("owner:read owner:write owner:read"), ["owner:read", "owner:write"]);
});
