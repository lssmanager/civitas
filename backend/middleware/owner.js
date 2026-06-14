const { requireScope } = require("./auth");
const { getOrCreateInternalUser, serializeUser } = require("../services/users");

const OWNER_READ_SCOPE = "owner:read";

async function attachOwner(req, res, next) {
  try {
    const internalUser = await getOrCreateInternalUser(req.user);

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

    console.error("Failed to resolve owner internal user", error);
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to resolve owner internal user" });
  }
}

const requireOwner = [requireScope(OWNER_READ_SCOPE), attachOwner];

module.exports = {
  OWNER_READ_SCOPE,
  attachOwner,
  requireOwner,
};
