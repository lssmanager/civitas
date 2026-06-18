const { extractRoleNames, requireScope } = require("./auth");

const requireOwnerScope = requireScope("owner:read");

const requireOwner = (req, res, next) => {
  if (req.user?.organizationId) {
    return res.status(403).json({
      error: "Forbidden",
      message: "Owner portal requires a global API access token, not an organization token",
    });
  }

  const roles = Array.isArray(req.user?.roles) ? req.user.roles : extractRoleNames(req.user?.claims || {});
  if (roles.length > 0 && !roles.includes("owner_global")) {
    return res.status(403).json({
      error: "Forbidden",
      message: "Owner portal requires the global Logto role owner_global when role claims are present",
      requiredRole: "owner_global",
    });
  }

  return requireOwnerScope(req, res, next);
};

module.exports = {
  requireOwner,
};