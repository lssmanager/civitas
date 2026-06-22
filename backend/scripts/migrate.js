const path = require("node:path");
const { migrate } = require("drizzle-orm/node-postgres/migrator");
const { db, pool } = require("../db/client");
const { getDatabaseConnectionTarget } = require("../db/connection");
const { validateMigrationManifest } = require("./migrationManifest");

async function runMigrations() {
  const target = getDatabaseConnectionTarget();

  const migrationsFolder = path.resolve(__dirname, "..", "drizzle");
  const manifest = validateMigrationManifest(migrationsFolder);

  console.log(
    `[migrate] running database migrations against ${target.host}:${target.port}/${target.database}`
  );
  console.log(`[migrate] migrations folder: ${migrationsFolder}`);
  console.log(`[migrate] available migration files: ${manifest.migrationFiles.join(", ") || "none"}`);

  try {
    await migrate(db, { migrationsFolder });
    console.log("[migrate] database migrations completed");
  } finally {
    await pool.end();
  }
}

runMigrations().catch((error) => {
  console.error("[migrate] database migrations failed", error);
  process.exit(1);
});
