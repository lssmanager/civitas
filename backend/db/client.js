const { drizzle } = require("drizzle-orm/node-postgres");
const { Pool } = require("pg");
const schema = require("./schema");
const { getDatabaseUrl } = require("./connection");

const statementTimeout = Number.parseInt(process.env.DATABASE_STATEMENT_TIMEOUT_MS || "12000", 10);
const queryTimeout = Number.parseInt(process.env.DATABASE_QUERY_TIMEOUT_MS || "15000", 10);

const pool = new Pool({
  connectionString: getDatabaseUrl(),
  statement_timeout: Number.isInteger(statementTimeout) && statementTimeout > 0 ? statementTimeout : 12000,
  query_timeout: Number.isInteger(queryTimeout) && queryTimeout > 0 ? queryTimeout : 15000,
});

const db = drizzle(pool, { schema });

module.exports = {
  db,
  pool,
};
