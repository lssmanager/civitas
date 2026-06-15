const { requireScope } = require("./auth");

const requireGlobalOwnerToken = (req, res, next) => {
  if (req.user?.organizationId) {
    return res.status(403).json({
      error: "Forbidden",
      message: "Owner portal requires a global API access token, not an organization token",
    });
  }

  return next();
};

const requireOwner = [requireGlobalOwnerToken, requireScope("owner:read")];

module.exports = {
  requireOwner,
};
