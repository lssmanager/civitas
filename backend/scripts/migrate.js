const { migrate } = require("drizzle-orm/node-postgres/migrator");
const { db, pool } = require("../db/client");
const { getDatabaseConnectionTarget } = require("../db/connection");

async function runMigrations() {
  const target = getDatabaseConnectionTarget();

  console.log(
    `Running database migrations against ${target.host}:${target.port}/${target.database}`
  );

  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("Database migrations completed");
  } finally {
    await pool.end();
  }
}

runMigrations().catch((error) => {
  console.error("Database migrations failed", error);
  process.exit(1);
});
