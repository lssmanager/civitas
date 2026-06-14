const { bootstrapOwnerForInternalUser } = require("../services/ownerBootstrap");
const { GLOBAL_ROLES, getOrCreateInternalUser, serializeUser } = require("../services/users");

async function requireOwner(req, res, next) {
  try {
    const internalUser = await bootstrapOwnerForInternalUser(await getOrCreateInternalUser(req.user));

    if (internalUser.globalRole !== GLOBAL_ROLES.OWNER) {
      return res.status(403).json({
        error: "Forbidden",
        message: "Authenticated user does not have owner_global permissions",
      });
    }

    req.internalUser = internalUser;
    req.owner = serializeUser(internalUser);
    return next();
  } catch (error) {
    if (error.status === 401) {
      return res.status(401).json({ error: "Unauthorized", message: error.message });
    }

    if (error.status === 403) {
      return res.status(403).json({ error: "Forbidden", message: error.message });
    }

    console.error("Failed to verify owner permissions", error);
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to verify owner permissions" });
  }
}

module.exports = {
  requireOwner,
};
