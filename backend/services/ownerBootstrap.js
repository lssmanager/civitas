const { GLOBAL_ROLES, InternalUserInactiveError, grantOwnerGlobalRole } = require("./users");

const BOOTSTRAP_ENABLED_VALUE = "true";

function isOwnerBootstrapEnabled() {
  return process.env.CIVITAS_BOOTSTRAP_OWNER_ENABLED === BOOTSTRAP_ENABLED_VALUE;
}

function getBootstrapOwnerLogtoUserId() {
  const value = process.env.CIVITAS_BOOTSTRAP_OWNER_LOGTO_USER_ID;
  return typeof value === "string" ? value.trim() : "";
}

function logBootstrap(message) {
  console.log(`[owner-bootstrap] ${message}`);
}

async function grantConfiguredBootstrapOwner() {
  if (!isOwnerBootstrapEnabled()) {
    logBootstrap("bootstrap disabled");
    return null;
  }

  const logtoUserId = getBootstrapOwnerLogtoUserId();
  if (!logtoUserId) {
    logBootstrap("bootstrap pending because no Logto user id is configured");
    return null;
  }

  try {
    const user = await grantOwnerGlobalRole({ logtoUserId });

    if (!user) {
      logBootstrap("bootstrap pending because user does not exist yet");
      return null;
    }

    logBootstrap("bootstrap owner granted");
    return user;
  } catch (error) {
    if (error instanceof InternalUserInactiveError) {
      logBootstrap("bootstrap skipped because user is inactive/blocked");
      return null;
    }

    throw error;
  }
}

async function bootstrapOwnerAtStartup() {
  try {
    return await grantConfiguredBootstrapOwner();
  } catch (error) {
    console.error("[owner-bootstrap] bootstrap failed", error instanceof Error ? error.message : error);
    return null;
  }
}

async function bootstrapOwnerForInternalUser(user) {
  if (!isOwnerBootstrapEnabled()) {
    return user;
  }

  const logtoUserId = getBootstrapOwnerLogtoUserId();
  if (!logtoUserId || user?.logtoUserId !== logtoUserId) {
    return user;
  }

  if (user.globalRole === GLOBAL_ROLES.OWNER) {
    return user;
  }

  const bootstrappedUser = await grantConfiguredBootstrapOwner();
  return bootstrappedUser || user;
}

module.exports = {
  bootstrapOwnerAtStartup,
  bootstrapOwnerForInternalUser,
  getBootstrapOwnerLogtoUserId,
  isOwnerBootstrapEnabled,
};
