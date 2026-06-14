const { createRemoteJWKSet, decodeJwt, jwtVerify, errors: joseErrors } = require("jose");

let jwks;

const getRequiredEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for Logto authentication`);
  }
  return value;
};

const getExpectedAudience = (audience) => audience || getRequiredEnv("LOGTO_API_RESOURCE_INDICATOR");

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
    error.authFailureReason = "missing authorization header";
    throw error;
  }

  const [type, token] = authorization.split(" ");
  if (type !== "Bearer" || !token) {
    const error = new Error("Authorization header must use Bearer token");
    error.status = 401;
    error.authFailureReason = "invalid authorization header";
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

const getSafeTokenClaims = (token) => {
  try {
    const payload = decodeJwt(token);
    return {
      sub: payload.sub,
      aud: payload.aud,
      iss: payload.iss,
      scope: payload.scope,
    };
  } catch (error) {
    return {};
  }
};

const getJwtFailureReason = (error) => {
  if (error instanceof joseErrors.JWTExpired) {
    return "expired";
  }

  if (error instanceof joseErrors.JWTClaimValidationFailed) {
    return `claim validation failed: ${error.claim}`;
  }

  if (error?.authFailureReason) {
    return error.authFailureReason;
  }

  return "invalid token";
};

const logAuthEvent = (req, event, details = {}) => {
  console.log(`[requireAuth] ${event}`, {
    route: req.originalUrl || req.url,
    method: req.method,
    ...details,
  });
};

const verifyAccessToken = async (token, audience = process.env.LOGTO_API_RESOURCE_INDICATOR) => {
  const { payload } = await jwtVerify(token, getJwks(), {
    issuer: getRequiredEnv("LOGTO_ISSUER"),
    audience: getExpectedAudience(audience),
  });

  return payload;
};

const requireAuth = ({ requiredScopes = [], audience = process.env.LOGTO_API_RESOURCE_INDICATOR } = {}) => {
  return async (req, res, next) => {
    let token;
    let safeClaims = {};
    const expectedIssuer = process.env.LOGTO_ISSUER;
    const expectedAudience = getExpectedAudience(audience);

    try {
      token = getTokenFromHeader(req.headers);
      safeClaims = getSafeTokenClaims(token);
      const payload = await verifyAccessToken(token, audience);
      const scopes = typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [];

      if (!hasRequiredScopes(scopes, requiredScopes)) {
        logAuthEvent(req, "forbidden", {
          sub: payload.sub,
          aud: payload.aud,
          iss: payload.iss,
          expectedAudience,
          expectedIssuer,
          reason: "scope",
          requiredScopes,
          tokenScopes: scopes,
        });

        return res.status(403).json({ error: "Forbidden", message: "Insufficient permissions" });
      }

      req.user = {
        id: payload.sub,
        sub: payload.sub,
        scopes,
        claims: payload,
      };

      logAuthEvent(req, "authenticated", {
        sub: payload.sub,
        aud: payload.aud,
        iss: payload.iss,
        expectedAudience,
        expectedIssuer,
        requiredScopes,
        tokenScopes: scopes,
      });

      return next();
    } catch (error) {
      const reason = getJwtFailureReason(error);
      const message = error instanceof joseErrors.JWTExpired ? "Access token expired" : "Invalid or missing access token";

      logAuthEvent(req, "unauthorized", {
        sub: safeClaims.sub,
        aud: safeClaims.aud,
        iss: safeClaims.iss,
        expectedAudience,
        expectedIssuer,
        reason,
      });

      return res.status(error.status || 401).json({ error: "Unauthorized", message });
    }
  };
};

const requireScope = (requiredScope) => {
  return (req, res, next) => {
    const scopes = Array.isArray(req.user?.scopes) ? req.user.scopes : [];

    if (scopes.includes(requiredScope)) {
      return next();
    }

    logAuthEvent(req, "forbidden", {
      sub: req.user?.sub,
      aud: req.user?.claims?.aud,
      iss: req.user?.claims?.iss,
      expectedAudience: process.env.LOGTO_API_RESOURCE_INDICATOR,
      expectedIssuer: process.env.LOGTO_ISSUER,
      reason: "scope",
      requiredScopes: [requiredScope],
      tokenScopes: scopes,
    });

    return res.status(403).json({ error: "Forbidden", message: "Insufficient permissions" });
  };
};

module.exports = {
  requireAuth,
  requireScope,
  verifyAccessToken,
};
