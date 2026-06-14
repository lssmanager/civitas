require("dotenv").config();
const { pool } = require("../db/client");
const { grantOwnerGlobalRole, serializeUser } = require("../services/users");

function readOption(name) {
  const equalsPrefix = `--${name}=`;
  const equalsArg = process.argv.find((value) => value.startsWith(equalsPrefix));

  if (equalsArg) {
    return equalsArg.slice(equalsPrefix.length);
  }

  const optionIndex = process.argv.indexOf(`--${name}`);
  const optionValue = optionIndex >= 0 ? process.argv[optionIndex + 1] : undefined;

  return optionValue && !optionValue.startsWith("--") ? optionValue : undefined;
}

async function main() {
  const logtoUserId =
    readOption("logto-user-id") ||
    process.env.CIVITAS_BOOTSTRAP_OWNER_LOGTO_USER_ID ||
    process.env.CIVITAS_OWNER_LOGTO_USER_ID;
  const email =
    readOption("email") || process.env.CIVITAS_BOOTSTRAP_OWNER_EMAIL || process.env.CIVITAS_OWNER_EMAIL;

  if (!logtoUserId && !email) {
    throw new Error(
      "Provide --logto-user-id <sub> (preferred), --logto-user-id=<sub>, --email <email>, CIVITAS_BOOTSTRAP_OWNER_LOGTO_USER_ID, CIVITAS_OWNER_LOGTO_USER_ID, CIVITAS_BOOTSTRAP_OWNER_EMAIL, or CIVITAS_OWNER_EMAIL"
    );
  }

  const user = await grantOwnerGlobalRole({ logtoUserId, email });

  if (!user) {
    throw new Error("No existing active Civitas user matched the provided owner identifier. Sign in once first or verify the identifier.");
  }

  console.log("Granted owner_global to Civitas user:");
  console.log(JSON.stringify(serializeUser(user), null, 2));
}

main()
  .catch((error) => {
    const detail = error.cause?.message ? `${error.message}: ${error.cause.message}` : error.message;
    console.error("Failed to grant owner_global", detail);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
