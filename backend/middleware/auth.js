const { createRemoteJWKSet, jwtVerify, errors: joseErrors } = require("jose");

// Fase 02 middleware: validate regular Logto API access tokens for global API
// routes. Organization tokens, tenant membership, owner/admin roles and internal
// PostgreSQL user synchronization are intentionally left for later phases.

let jwks;

const getRequiredEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for Logto authentication`);
  }
  return value;
};

const getJwks = () => {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(getRequiredEnv("LOGTO_JWKS_URL")));
  }
  return jwks;
};

const getTokenFromHeader = (headers) => {
  const authorization = headers.authorization;

  if (!authorization) {
    const error = new Error("Authorization header missing");
    error.status = 401;
    throw error;
  }

  const [type, token] = authorization.split(" ");
  if (type !== "Bearer" || !token) {
    const error = new Error("Authorization header must use Bearer token");
    error.status = 401;
    throw error;
  }

  return token;
};

const hasRequiredScopes = (tokenScopes, requiredScopes) => {
  if (!requiredScopes || requiredScopes.length === 0) {
    return true;
  }

  const scopeSet = new Set(tokenScopes);
  return requiredScopes.every((scope) => scopeSet.has(scope));
};

const verifyAccessToken = async (token, audience = process.env.LOGTO_API_RESOURCE_INDICATOR) => {
  const { payload } = await jwtVerify(token, getJwks(), {
    issuer: getRequiredEnv("LOGTO_ISSUER"),
    audience: audience || getRequiredEnv("LOGTO_API_RESOURCE_INDICATOR"),
  });

  return payload;
};

const requireAuth = ({ requiredScopes = [], audience = process.env.LOGTO_API_RESOURCE_INDICATOR } = {}) => {
  return async (req, res, next) => {
    try {
      const token = getTokenFromHeader(req.headers);
      const payload = await verifyAccessToken(token, audience);
      const scopes = typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [];

      if (!hasRequiredScopes(scopes, requiredScopes)) {
        return res.status(403).json({ error: "Forbidden", message: "Insufficient permissions" });
      }

      req.user = {
        id: payload.sub,
        sub: payload.sub,
        scopes,
        claims: payload,
      };

      return next();
    } catch (error) {
      const message = error instanceof joseErrors.JWTExpired ? "Access token expired" : "Invalid or missing access token";
      return res.status(error.status || 401).json({ error: "Unauthorized", message });
    }
  };
};

module.exports = {
  requireAuth,
  verifyAccessToken,
};
