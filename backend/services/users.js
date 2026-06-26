const { and, eq, ne } = require("drizzle-orm");
const { db } = require("../db/client");
const { users } = require("../db/schema");
const { getTimeoutMs, measureAsync, withTimeout } = require("./timeouts");
const { buildSafePostgresErrorDiagnostic, classifyPostgresOperationalError } = require("./postgresErrors");

const INACTIVE_STATUSES = new Set(["blocked", "inactive"]);
const SESSION_INTERNAL_USER_TIMEOUT_MS = getTimeoutMs("SESSION_INTERNAL_USER_TIMEOUT_MS", 3000);

class AuthUserMissingSubError extends Error {
  constructor() {
    super("Authenticated token is missing subject");
    this.name = "AuthUserMissingSubError";
    this.status = 401;
  }
}

class InternalUserInactiveError extends Error {
  constructor(status) {
    super("User is not active");
    this.name = "InternalUserInactiveError";
    this.status = 403;
    this.userStatus = status;
  }
}

const normalizeEmail = (email) => {
  if (typeof email !== "string") {
    return null;
  }

  const normalized = email.trim().toLowerCase();
  return normalized || null;
};

const getEmailFromClaims = (claims = {}) => {
  return normalizeEmail(claims.email || claims.primary_email || claims.email_address || claims.username);
};

const getDisplayNameFromClaims = (claims = {}) => {
  const value = claims.name || claims.display_name || claims.full_name || claims.nickname || claims.username || claims.email || claims.sub;
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const getUsernameFromClaims = (claims = {}) => {
  const value = claims.username || claims.preferred_username || claims.nickname;
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const getIdentityFromLogtoClaims = (claims = {}) => ({
  logtoUserId: claims.sub || null,
  email: getEmailFromClaims(claims),
  displayName: getDisplayNameFromClaims(claims),
  username: getUsernameFromClaims(claims),
});

const userSessionColumns = {
  id: users.id,
  logtoUserId: users.logtoUserId,
  email: users.email,
  status: users.status,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

const serializeUser = (user) => ({
  id: user.id,
  logtoUserId: user.logtoUserId,
  email: user.email,
  status: user.status,
  lastLoginAt: user.lastLoginAt?.toISOString?.() ?? user.lastLoginAt,
  createdAt: user.createdAt?.toISOString?.() ?? user.createdAt,
  updatedAt: user.updatedAt?.toISOString?.() ?? user.updatedAt,
});

async function findUserByLogtoUserId(logtoUserId) {
  const [user] = await db.select(userSessionColumns).from(users).where(eq(users.logtoUserId, logtoUserId)).limit(1);
  return user;
}

async function createUserFromLogtoClaims(claims) {
  const now = new Date();
  const [user] = await db
    .insert(users)
    .values({
      logtoUserId: claims.sub,
      email: getEmailFromClaims(claims),
      status: "active",
      lastLoginAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.logtoUserId,
      set: {
        lastLoginAt: now,
        updatedAt: now,
      },
    })
    .returning(userSessionColumns);

  return user;
}

async function updateLastLogin(userId, email) {
  const now = new Date();
  const updateValues = {
    lastLoginAt: now,
    updatedAt: now,
  };

  if (email) {
    updateValues.email = email;
  }

  const [user] = await db.update(users).set(updateValues).where(eq(users.id, userId)).returning(userSessionColumns);
  return user;
}

async function emailBelongsToAnotherUser(email, currentUserId) {
  if (!email) {
    return false;
  }

  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), ne(users.id, currentUserId)))
    .limit(1);

  return Boolean(existingUser);
}

async function updateLastLoginBestEffort(user, email) {
  const shouldCheckEmail = email && email !== user.email;
  try {
    const emailAvailable = shouldCheckEmail
      ? !(await measureAsync("PostgreSQL users email uniqueness check for /api/me", () => emailBelongsToAnotherUser(email, user.id), { warnAfterMs: 1000 }))
      : false;
    await measureAsync("PostgreSQL users last-login update for /api/me", () => updateLastLogin(user.id, emailAvailable ? email : undefined), { warnAfterMs: 1000 });
  } catch (error) {
    const classified = classifyPostgresOperationalError(error, "/api/me best-effort last-login update");
    console.warn("Best-effort last-login update failed during /api/me", {
      code: classified?.code,
      status: classified?.status,
      diagnostic: classified?.diagnostic || buildSafePostgresErrorDiagnostic(error),
    });
  }
}

async function getOrCreateInternalUser(authUser) {
  const claims = authUser?.claims || authUser || {};
  const logtoUserId = authUser?.sub || claims.sub;

  if (!logtoUserId) {
    throw new AuthUserMissingSubError();
  }

  let user;
  try {
    user = await measureAsync("PostgreSQL users lookup for /api/me", () => findUserByLogtoUserId(logtoUserId), { warnAfterMs: 1000 });

    if (!user) {
      user = await measureAsync("PostgreSQL users create for /api/me", () => createUserFromLogtoClaims({ ...claims, sub: logtoUserId }), { warnAfterMs: 1000 });
    }

    if (INACTIVE_STATUSES.has(user.status)) {
      throw new InternalUserInactiveError(user.status);
    }
  } catch (error) {
    if (error instanceof InternalUserInactiveError) throw error;
    const classified = classifyPostgresOperationalError(error, "/api/me internal user projection");
    if (classified !== error) {
      console.error("PostgreSQL operational issue while resolving /api/me", classified.diagnostic);
    }
    throw classified;
  }

  const email = getEmailFromClaims({ ...claims, sub: logtoUserId });
  setImmediate(() => updateLastLoginBestEffort(user, email));
  return user;
}

async function resolveInternalUserForSession(authUser) {
  return withTimeout(() => getOrCreateInternalUser(authUser), {
    timeoutMs: SESSION_INTERNAL_USER_TIMEOUT_MS,
    label: "/api/me internal user resolution",
    code: "SESSION_INTERNAL_USER_TIMEOUT",
    name: "SessionInternalUserTimeoutError",
    status: 503,
    onTimeout: () => console.error("Timed out resolving internal user for session", { timeoutMs: SESSION_INTERNAL_USER_TIMEOUT_MS }),
  });
}

module.exports = {
  AuthUserMissingSubError,
  InternalUserInactiveError,
  createUserFromLogtoClaims,
  findUserByLogtoUserId,
  getIdentityFromLogtoClaims,
  getOrCreateInternalUser,
  resolveInternalUserForSession,
  serializeUser,
  updateLastLogin,
  updateLastLoginBestEffort,
};
