const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { requireAuth } = require("./middleware/auth");
const { requireOwner } = require("./middleware/owner");
const { checkDatabaseConnection } = require("./db/connection");
const { getOrCreateInternalUser, serializeUser } = require("./services/users");
const { createOrganization, listOrganizations } = require("./services/organizations");
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

// Protected auth smoke test for Fase 02. It validates a regular Logto API access
// token only; organization tokens and internal Civitas users are intentionally out of scope.
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


app.get("/owner/me", requireAuth(), requireOwner, (req, res) => {
  return res.json({
    owner: req.owner,
    scope: {
      organizations: true,
      memberships: false,
      rbac: false,
    },
  });
});

app.get("/owner/organizations", requireAuth(), requireOwner, async (req, res) => {
  try {
    const organizations = await listOrganizations();
    return res.json({ organizations });
  } catch (error) {
    console.error("Failed to list organizations", error);
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to list organizations" });
  }
});

app.post("/owner/organizations", requireAuth(), requireOwner, async (req, res) => {
  try {
    const organization = await createOrganization(req.body);
    return res.status(201).json({ organization });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ error: "Bad Request", message: error.message, details: error.details });
    }

    if (error.status === 409) {
      return res.status(409).json({ error: "Conflict", message: error.message, field: error.field });
    }

    console.error("Failed to create organization", error);
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to create organization" });
  }
});

app.get("/me", requireAuth(), async (req, res) => {
  try {
    const internalUser = await getOrCreateInternalUser(req.user);

    return res.json({
      user: serializeUser(internalUser),
      auth: {
        sub: req.user.sub,
        issuer: req.user.claims?.iss,
      },
    });
  } catch (error) {
    if (error.status === 401) {
      return res.status(401).json({ error: "Unauthorized", message: error.message });
    }

    if (error.status === 403) {
      return res.status(403).json({ error: "Forbidden", message: error.message });
    }

    console.error("Failed to resolve internal user", error);
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to resolve internal user" });
  }
});

// Basic route
app.get("/", (req, res) => {
  res.json({ message: "Welcome to the Civitas API", health: "/health" });
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
