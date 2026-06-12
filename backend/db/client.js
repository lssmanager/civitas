const { drizzle } = require("drizzle-orm/node-postgres");
const { Pool } = require("pg");
const schema = require("./schema");
const { getDatabaseUrl } = require("./connection");

const pool = new Pool({
  connectionString: getDatabaseUrl(),
});

const db = drizzle(pool, { schema });

module.exports = {
  db,
  pool,
};
