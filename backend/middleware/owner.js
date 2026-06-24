const { extractGlobalRoleNames, hasRequiredScopes } = require("./auth");
const { listLogtoOrganizationUsers } = require("../services/logtoManagement");

const OWNER_GLOBAL_ROLE = "owner_global";
const OWNER_READ_SCOPE = "owner:read";
const OWNER_WRITE_SCOPE = "owner:write";
const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const getOwnerRequiredScopes = (method = "GET") =>
  READ_ONLY_METHODS.has(String(method).toUpperCase())
    ? [OWNER_READ_SCOPE]
    : [OWNER_READ_SCOPE, OWNER_WRITE_SCOPE];

const getLogtoUserId = (member = {}) => member.id || member.userId || member.logtoUserId || member.sub || null;

async function verifyTenantScopedMemberAccess({ organizationId, logtoUserId, listOrganizationUsers = listLogtoOrganizationUsers } = {}) {
  if (!organizationId || !logtoUserId) {
    return true;
  }

  const members = await listOrganizationUsers({ organizationId });
  return members.some((member) => getLogtoUserId(member) === logtoUserId);
}

const createRequireOwner = ({ listOrganizationUsers = listLogtoOrganizationUsers } = {}) => {
  return async (req, res, next) => {
    try {
      if (req.user?.organizationId) {
        return res.status(403).json({
          error: "Forbidden",
          message: "Owner portal requires a global API access token, not an organization token",
        });
      }

      const globalRoles = Array.isArray(req.user?.globalRoles)
        ? req.user.globalRoles
        : extractGlobalRoleNames(req.user?.claims || {});
      if (!globalRoles.includes(OWNER_GLOBAL_ROLE)) {
        return res.status(403).json({
          error: "Forbidden",
          message: "Owner portal requires the global Logto role owner_global",
          requiredRole: OWNER_GLOBAL_ROLE,
        });
      }

      const requiredScopes = getOwnerRequiredScopes(req.method);
      const scopes = Array.isArray(req.user?.scopes) ? req.user.scopes : [];
      if (!hasRequiredScopes(scopes, requiredScopes)) {
        return res.status(403).json({
          error: "Forbidden",
          message: "Owner token does not have the required scope set for this operation",
          requiredScopes,
        });
      }

      const organizationId = req.params?.organizationId;
      const logtoUserId = req.params?.logtoUserId;
      if (organizationId && logtoUserId) {
        const belongsToOrganization = await verifyTenantScopedMemberAccess({
          organizationId,
          logtoUserId,
          listOrganizationUsers,
        });
        if (!belongsToOrganization) {
          return res.status(404).json({
            error: "Not Found",
            message: "Organization member not found in the requested Logto organization",
          });
        }
      }

      return next();
    } catch (error) {
      return res.status(error.status || 502).json({
        error: error.status === 404 ? "Not Found" : "Bad Gateway",
        message: error.status === 404
          ? error.message
          : "Failed to verify owner authorization against Logto",
      });
    }
  };
};

const requireOwner = createRequireOwner();

module.exports = {
  OWNER_GLOBAL_ROLE,
  OWNER_READ_SCOPE,
  OWNER_WRITE_SCOPE,
  createRequireOwner,
  getOwnerRequiredScopes,
  requireOwner,
  verifyTenantScopedMemberAccess,
};