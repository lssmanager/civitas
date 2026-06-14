const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { requireAuth, requireOrganizationAccess, requireScope } = require("./middleware/auth");
const { requireOwner } = require("./middleware/owner");
const { checkDatabaseConnection } = require("./db/connection");
const { getOrCreateInternalUser, serializeUser } = require("./services/users");
const {
  ORGANIZATION_ADMIN_ROLE_NAME,
  addUserToLogtoOrganization,
  assignOrganizationRoleToUser,
  createLogtoOrganization,
  findOrganizationRoleByName,
} = require("./services/logtoManagement");
const {
  createOrganizationProfile,
  listOrganizationProfiles,
  markOrganizationProfileLogtoSyncError,
  markOrganizationProfileLogtoSynced,
  serializeOrganizationProfile,
} = require("./services/organizationProfiles");
const {
  AUDIT_ACTIONS,
  AUDIT_RESULTS,
  listAuditLogs,
  recordAuditLogBestEffort,
} = require("./services/auditLogs");

const app = express();
const port = process.env.PORT || 3000;
const API_RESOURCE = process.env.LOGTO_API_RESOURCE_INDICATOR;

app.use(cors());
app.use(express.json());

const getLogtoOrganizationId = (organization) => organization.id || organization.organizationId || organization.logtoOrganizationId;
const getLogtoOrganizationName = (organization) => organization.name || organization.nameCache || null;

const serializeOwnerOrganization = (profile) => ({
  logtoOrganizationId: profile.logtoOrganizationId,
  name: profile.nameCache,
  profile: serializeOrganizationProfile(profile),
});

const getSafeErrorMessage = (error) => {
  if (!error) return "Logto synchronization failed";
  const status = error.status ? ` (${error.status})` : "";
  return `${error.message || "Logto synchronization failed"}${status}`;
};

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

app.get("/auth/test", requireAuth(API_RESOURCE), (req, res) => {
  res.json({
    status: "ok",
    message: "Authenticated with Logto API access token",
    user: {
      sub: req.user.sub,
      scopes: req.user.scopes,
    },
  });
});

app.get("/me", requireAuth(API_RESOURCE), async (req, res) => {
  try {
    const internalUser = await getOrCreateInternalUser(req.user);

    return res.json({
      user: serializeUser(internalUser),
      auth: {
        sub: req.user.sub,
        issuer: req.user.claims?.iss,
        audience: req.user.claims?.aud,
        scopes: req.user.scopes,
        organizationId: req.user.organizationId,
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

app.get("/owner/me", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  try {
    const internalUser = await getOrCreateInternalUser(req.user);

    return res.json({
      owner: {
        logtoUserId: req.user.sub,
        internalUserId: internalUser.id,
        authorizedBy: "logto_scope",
        requiredScope: "owner:read",
        scopes: req.user.scopes,
      },
    });
  } catch (error) {
    if (error.status === 401) {
      return res.status(401).json({ error: "Unauthorized", message: error.message });
    }

    if (error.status === 403) {
      return res.status(403).json({ error: "Forbidden", message: error.message });
    }

    console.error("Failed to resolve owner metadata", error);
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to resolve owner metadata" });
  }
});

app.get("/owner/organizations", requireAuth(API_RESOURCE), requireScope("organizations:read"), async (req, res) => {
  try {
    const profiles = await listOrganizationProfiles();
    return res.json({ organizations: profiles.map(serializeOwnerOrganization) });
  } catch (error) {
    console.error("Failed to list internal organizations", error);
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to list organizations" });
  }
});

app.post("/owner/organizations", requireAuth(API_RESOURCE), requireScope("organizations:create"), async (req, res) => {
  let internalUser = null;
  let profile = null;
  const { name, description, type, subdomain, seatTotal } = req.body || {};
  const normalizedName = typeof name === "string" ? name.trim() : "";

  try {
    internalUser = await getOrCreateInternalUser(req.user);

    if (!normalizedName) {
      await recordAuditLogBestEffort({
        actorUserId: internalUser.id,
        action: AUDIT_ACTIONS.OWNER_ORGANIZATION_CREATE,
        result: AUDIT_RESULTS.ERROR,
        metadata: { reason: "validation_error", field: "name" },
      });
      return res.status(400).json({ error: "Bad Request", message: "Organization name is required" });
    }

    profile = await createOrganizationProfile({ nameCache: normalizedName, type, subdomain, seatTotal });

    await recordAuditLogBestEffort({
      actorUserId: internalUser.id,
      organizationId: profile.id,
      action: AUDIT_ACTIONS.OWNER_ORGANIZATION_CREATE,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: { name: normalizedName, profileId: profile.id, logtoSyncStatus: profile.logtoSyncStatus },
    });
  } catch (error) {
    await recordAuditLogBestEffort({
      actorUserId: internalUser?.id ?? null,
      action: AUDIT_ACTIONS.OWNER_ORGANIZATION_CREATE,
      result: AUDIT_RESULTS.ERROR,
      metadata: { name: normalizedName || name, type, subdomain, seatTotal, error },
    });

    console.error("Failed to persist internal organization", error);
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to create internal organization" });
  }

  try {
    const logtoOrganization = await createLogtoOrganization({ name: normalizedName, description });
    const logtoOrganizationId = getLogtoOrganizationId(logtoOrganization);

    if (!logtoOrganizationId) {
      throw new Error("Logto organization creation response did not include an organization id");
    }

    await addUserToLogtoOrganization({ organizationId: logtoOrganizationId, userId: req.user.sub });

    const adminRole = await findOrganizationRoleByName(ORGANIZATION_ADMIN_ROLE_NAME);
    if (!adminRole?.id) {
      throw new Error(`Logto organization role not found: ${ORGANIZATION_ADMIN_ROLE_NAME}`);
    }

    await assignOrganizationRoleToUser({
      organizationId: logtoOrganizationId,
      userId: req.user.sub,
      organizationRoleId: adminRole.id,
    });

    profile = await markOrganizationProfileLogtoSynced({
      id: profile.id,
      logtoOrganizationId,
      nameCache: getLogtoOrganizationName(logtoOrganization) || normalizedName,
    });

    await recordAuditLogBestEffort({
      actorUserId: internalUser.id,
      organizationId: logtoOrganizationId,
      action: AUDIT_ACTIONS.OWNER_ORGANIZATION_LOGTO_SYNC,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: { profileId: profile.id, name: normalizedName, logtoOrganizationId },
    });

    return res.status(201).json({ organization: serializeOwnerOrganization(profile) });
  } catch (error) {
    const errorMessage = getSafeErrorMessage(error);
    profile = await markOrganizationProfileLogtoSyncError({ id: profile.id, errorMessage }).catch((persistenceError) => {
      console.error(`Failed to mark Logto sync error for organization profile ${profile?.id}`, persistenceError);
      return profile;
    });

    await recordAuditLogBestEffort({
      actorUserId: internalUser.id,
      organizationId: profile?.logtoOrganizationId || profile?.id,
      action: AUDIT_ACTIONS.OWNER_ORGANIZATION_LOGTO_SYNC,
      result: AUDIT_RESULTS.ERROR,
      metadata: { profileId: profile?.id, name: normalizedName, error: errorMessage },
    });

    console.error("Failed to synchronize organization with Logto", error);
    return res.status(201).json({ organization: serializeOwnerOrganization(profile), warning: "Logto synchronization failed" });
  }
});

app.get("/owner/audit", requireAuth(API_RESOURCE), requireOwner, async (req, res) => {
  try {
    await getOrCreateInternalUser(req.user);

    const result = await listAuditLogs({ limit: req.query.limit, offset: req.query.offset });
    return res.json(result);
  } catch (error) {
    if (error.status === 401) {
      return res.status(401).json({ error: "Unauthorized", message: error.message });
    }

    if (error.status === 403) {
      return res.status(403).json({ error: "Forbidden", message: error.message });
    }

    console.error("Failed to list audit logs", error);
    return res.status(500).json({ error: "Internal Server Error", message: "Failed to list audit logs" });
  }
});

app.get(
  "/organizations/:organizationId/documents",
  requireOrganizationAccess({ requiredScopes: ["documents:read"] }),
  async (req, res) => {
    return res.json({
      organizationId: req.user.organizationId,
      documents: [],
      source: "organization_token",
    });
  }
);

app.post(
  "/organizations/:organizationId/documents",
  requireOrganizationAccess({ requiredScopes: ["documents:create"] }),
  async (req, res) => {
    return res.status(201).json({
      organizationId: req.user.organizationId,
      document: null,
      source: "organization_token",
      message: "Organization-scoped document creation placeholder",
    });
  }
);

app.get("/", (req, res) => {
  res.json({ message: "Welcome to the Civitas API", health: "/health" });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
