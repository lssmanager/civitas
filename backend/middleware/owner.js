const { requireScope } = require("./auth");

const requireOwnerScope = requireScope("owner:read");

const requireOwner = (req, res, next) => {
  if (req.user?.organizationId) {
    return res.status(403).json({
      error: "Forbidden",
      message: "Owner portal requires a global API access token, not an organization token",
    });
  }

  return requireOwnerScope(req, res, next);
};

module.exports = {
  requireOwner,
};
