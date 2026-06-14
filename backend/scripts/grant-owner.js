require("dotenv").config();
const { pool } = require("../db/client");
const { grantOwnerGlobalRole, serializeUser } = require("../services/users");

function readOption(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

async function main() {
  const logtoUserId = readOption("logto-user-id") || process.env.CIVITAS_BOOTSTRAP_OWNER_LOGTO_USER_ID;
  const email = readOption("email") || process.env.CIVITAS_BOOTSTRAP_OWNER_EMAIL;

  if (!logtoUserId && !email) {
    throw new Error(
      "Provide --logto-user-id=<sub> (preferred), --email=<email>, CIVITAS_BOOTSTRAP_OWNER_LOGTO_USER_ID, or CIVITAS_BOOTSTRAP_OWNER_EMAIL"
    );
  }

  const user = await grantOwnerGlobalRole({ logtoUserId, email });

  if (!user) {
    throw new Error("No existing Civitas user matched the provided owner identifier. Sign in once first or verify the identifier.");
  }

  console.log("Granted owner_global to Civitas user:");
  console.log(JSON.stringify(serializeUser(user), null, 2));
}

main()
  .catch((error) => {
    console.error("Failed to grant owner_global", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
