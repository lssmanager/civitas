const { createRemoteJWKSet, jwtVerify, errors: joseErrors } = require("jose");

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

const parseScopes = (scope) => (typeof scope === "string" ? scope.split(" ").filter(Boolean) : []);

const getOrganizationIdFromPayload = (payload) => payload.organization_id || payload.organizationId || null;

const verifyAccessToken = async (token, audience = process.env.LOGTO_API_RESOURCE_INDICATOR) => {
  const { payload } = await jwtVerify(token, getJwks(), {
    issuer: getRequiredEnv("LOGTO_ISSUER"),
    audience: audience || getRequiredEnv("LOGTO_API_RESOURCE_INDICATOR"),
  });

  return payload;
};

const requireAuth = ({ audience = process.env.LOGTO_API_RESOURCE_INDICATOR } = {}) => {
  return async (req, res, next) => {
    try {
      const token = getTokenFromHeader(req.headers);
      const payload = await verifyAccessToken(token, audience);
      const scopes = parseScopes(payload.scope);
      const organizationId = getOrganizationIdFromPayload(payload);

      req.user = {
        id: payload.sub,
        sub: payload.sub,
        scopes,
        organizationId,
        claims: payload,
      };

      return next();
    } catch (error) {
      const message = error instanceof joseErrors.JWTExpired ? "Access token expired" : "Invalid or missing access token";
      return res.status(error.status || 401).json({ error: "Unauthorized", message });
    }
  };
};

const requireScope = (requiredScope) => {
  return (req, res, next) => {
    const scopes = Array.isArray(req.user?.scopes) ? req.user.scopes : [];

    if (!scopes.includes(requiredScope)) {
      return res.status(403).json({
        error: "Forbidden",
        message: `Missing required Logto scope: ${requiredScope}`,
        requiredScope,
      });
    }

    return next();
  };
};

module.exports = {
  requireAuth,
  requireScope,
  verifyAccessToken,
};
