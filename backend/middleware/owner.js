const { extractGlobalRoleNames, requireScope } = require("./auth");

const requireOwnerScope = requireScope("owner:read");

const requireOwner = (req, res, next) => {
  if (req.user?.organizationId) {
    return res.status(403).json({
      error: "Forbidden",
      message: "Owner portal requires a global API access token, not an organization token",
    });
  }

  const globalRoles = Array.isArray(req.user?.globalRoles)
    ? req.user.globalRoles
    : extractGlobalRoleNames(req.user?.claims || {});
  if (globalRoles.length > 0 && !globalRoles.includes("owner_global")) {
    return res.status(403).json({
      error: "Forbidden",
      message: "Owner portal requires the global Logto role owner_global when global role claims are present",
      requiredRole: "owner_global",
    });
  }

  return requireOwnerScope(req, res, next);
};

module.exports = {
  requireOwner,
};