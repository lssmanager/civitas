const { buildOwnerCapabilities } = require("../middleware/owner");

const normalizeStringList = (value) => Array.isArray(value)
  ? [...new Set(value.map(String).filter(Boolean))]
  : typeof value === "string"
    ? [...new Set(value.split(/[\s,]+/).filter(Boolean))]
    : [];

const buildSessionTokenMetadata = (claims = {}) => ({
  issuedAt: claims.iat ? new Date(Number(claims.iat) * 1000).toISOString() : null,
  expiresAt: claims.exp ? new Date(Number(claims.exp) * 1000).toISOString() : null,
  permissionFreshness: "Token claims are authoritative for this request; Logto role changes apply after token renewal or expiration.",
});

const buildAuthorizationMetadata = (authUser = {}) => {
  const claims = authUser.claims || {};
  const scopes = normalizeStringList(authUser.scopes ?? claims.scope);
  const globalRoles = normalizeStringList(authUser.globalRoles ?? claims.global_roles ?? claims.globalRoles);
  const organizationRoles = normalizeStringList(authUser.organizationRoles ?? claims.organization_roles ?? claims.organizationRoles ?? claims.org_roles);
  const authUserRoles = normalizeStringList(authUser.roles);
  const roles = authUserRoles.length ? authUserRoles : [...new Set([...globalRoles, ...organizationRoles])];
  const organizationId = authUser.organizationId ?? claims.organization_id ?? claims.organizationId ?? null;

  return {
    sub: authUser.sub ?? claims.sub ?? null,
    issuer: claims.iss ?? null,
    audience: claims.aud ?? null,
    scopes,
    roles,
    globalRoles,
    organizationRoles,
    organizationId,
    owner: buildOwnerCapabilities({ ...authUser, scopes, globalRoles, organizationId, claims }),
    token: buildSessionTokenMetadata(claims),
  };
};

module.exports = {
  buildAuthorizationMetadata,
  buildSessionTokenMetadata,
  normalizeStringList,
};
