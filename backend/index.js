const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { requireAuth } = require("./middleware/auth");
const { checkDatabaseConnection } = require("./db/connection");
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Local base healthcheck. It intentionally does not depend on Logto or any external integration.
app.get("/health", async (req, res) => {
  const database = await checkDatabaseConnection();
  const healthy = database.ok;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    service: "civitas-api",
    timestamp: new Date().toISOString(),
    database: {
      status: healthy ? "connected" : "unavailable",
      host: database.host,
      port: database.port,
      name: database.database,
      ...(database.error ? { error: database.error } : {}),
    },
  });
});

// Fase 02 exposes only the auth smoke test below in addition to /health.
// Legacy sample routes for organizations/documents are deliberately not mounted here
// because they depend on organization tokens, Logto Management API roles and
// multi-tenant behavior that are outside this implementation phase. The supporting
// infrastructure files are kept in the repo for future phases; this is cleanup of
// out-of-scope sample flow, not a product decision against those capabilities.
// This endpoint validates a regular Logto API access token only.
app.get("/auth/test", requireAuth(), (req, res) => {
  res.json({
    status: "ok",
    message: "Authenticated with Logto access token",
    user: {
      sub: req.user.sub,
      scopes: req.user.scopes,
    },
  });
});

// Basic route
app.get("/", (req, res) => {
  res.json({ message: "Welcome to the Civitas API", health: "/health" });
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
