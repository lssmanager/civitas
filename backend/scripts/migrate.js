const path = require("node:path");
const fs = require("node:fs");
const { migrate } = require("drizzle-orm/node-postgres/migrator");
const { db, pool } = require("../db/client");
const { getDatabaseConnectionTarget } = require("../db/connection");

async function runMigrations() {
  const target = getDatabaseConnectionTarget();

  const migrationsFolder = path.resolve(__dirname, "..", "drizzle");
  const migrationFiles = fs
    .readdirSync(migrationsFolder)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  console.log(
    `[migrate] running database migrations against ${target.host}:${target.port}/${target.database}`
  );
  console.log(`[migrate] migrations folder: ${migrationsFolder}`);
  console.log(`[migrate] available migration files: ${migrationFiles.join(", ") || "none"}`);

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
