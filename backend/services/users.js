const { and, eq, ne } = require("drizzle-orm");
const { db } = require("../db/client");
const { users } = require("../db/schema");
const { measureAsync } = require("./timeouts");

const INACTIVE_STATUSES = new Set(["blocked", "inactive"]);

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

async function getOrCreateInternalUser(authUser) {
  const claims = authUser?.claims || authUser || {};
  const logtoUserId = authUser?.sub || claims.sub;

  if (!logtoUserId) {
    throw new AuthUserMissingSubError();
  }

  const email = getEmailFromClaims({ ...claims, sub: logtoUserId });
  let user = await measureAsync("PostgreSQL users lookup for /api/me", () => findUserByLogtoUserId(logtoUserId), { warnAfterMs: 1000 });

  if (!user) {
    user = await measureAsync("PostgreSQL users create for /api/me", () => createUserFromLogtoClaims({ ...claims, sub: logtoUserId }), { warnAfterMs: 1000 });
  }

  if (INACTIVE_STATUSES.has(user.status)) {
    throw new InternalUserInactiveError(user.status);
  }

  const shouldUpdateEmail = email && email !== user.email && !(await measureAsync("PostgreSQL users email uniqueness check for /api/me", () => emailBelongsToAnotherUser(email, user.id), { warnAfterMs: 1000 }));
  user = await measureAsync("PostgreSQL users last-login update for /api/me", () => updateLastLogin(user.id, shouldUpdateEmail ? email : undefined), { warnAfterMs: 1000 });

  return user;
}

module.exports = {
  AuthUserMissingSubError,
  InternalUserInactiveError,
  createUserFromLogtoClaims,
  findUserByLogtoUserId,
  getIdentityFromLogtoClaims,
  getOrCreateInternalUser,
  serializeUser,
  updateLastLogin,
};
