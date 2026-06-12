require("dotenv").config();

const { DEFAULT_DATABASE_URL } = require("./db/connection");

module.exports = {
  schema: "./db/schema.js",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  },
};
