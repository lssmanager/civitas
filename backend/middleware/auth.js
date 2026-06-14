const { createRemoteJWKSet, jwtVerify, errors: joseErrors } = require("jose");

const ORGANIZATION_AUDIENCE_PREFIX = "urn:logto:organization:";
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

const normalizeAudience = (audience) => (Array.isArray(audience) ? audience[0] : audience);

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

const decodeJwtPayload = (token) => {
  try {
    const [, payloadBase64] = token.split(".");
    if (!payloadBase64) {
      throw new Error("Invalid token format");
    }

    return JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8"));
  } catch (error) {
    const decodeError = new Error("Failed to decode token payload");
    decodeError.status = 401;
    throw decodeError;
  }
};

const extractOrganizationId = (payloadOrAudience) => {
  if (payloadOrAudience && typeof payloadOrAudience === "object") {
    if (payloadOrAudience.organization_id) {
      return payloadOrAudience.organization_id;
    }

    if (payloadOrAudience.organizationId) {
      return payloadOrAudience.organizationId;
    }

    return extractOrganizationId(payloadOrAudience.aud);
  }

  const audiences = Array.isArray(payloadOrAudience) ? payloadOrAudience : [payloadOrAudience];
  const organizationAudience = audiences.find(
    (audience) => typeof audience === "string" && audience.startsWith(ORGANIZATION_AUDIENCE_PREFIX)
  );

  if (organizationAudience) {
    return organizationAudience.slice(ORGANIZATION_AUDIENCE_PREFIX.length);
  }

  return null;
};

const parseScopes = (scope) => {
  if (Array.isArray(scope)) {
    return scope.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim());
  }

  return String(scope || "").split(" ").filter(Boolean);
};

const hasRequiredScopes = (tokenScopes, requiredScopes = []) => {
  if (!requiredScopes || requiredScopes.length === 0) {
    return true;
  }

  const scopeSet = new Set(tokenScopes);
  return requiredScopes.every((scope) => scopeSet.has(scope));
};

const verifyJwt = async (token, audience) => {
  const { payload } = await jwtVerify(token, getJwks(), {
    issuer: getRequiredEnv("LOGTO_ISSUER"),
    audience,
  });

  return payload;
};

const requireAuth = (resource = process.env.LOGTO_API_RESOURCE_INDICATOR) => {
  if (!resource) {
    throw new Error("Resource parameter is required for authentication");
  }

  return async (req, res, next) => {
    try {
      const token = getTokenFromHeader(req.headers);
      const payload = await verifyJwt(token, resource);
      const scopes = parseScopes(payload.scope);

      req.user = {
        id: payload.sub,
        sub: payload.sub,
        scopes,
        organizationId: extractOrganizationId(payload),
        claims: payload,
      };

      return next();
    } catch (error) {
      const message = error instanceof joseErrors.JWTExpired ? "Access token expired" : "Invalid or missing access token";
      return res.status(error.status || 401).json({ error: "Unauthorized", message });
    }
  };
};

const logScopeAuthorization = ({ req, requiredScope, scopes, allowed, reason }) => {
  console.info("Logto scope authorization", {
    route: req.originalUrl || req.url,
    method: req.method,
    sub: req.user?.sub,
    detectedScopes: scopes,
    requiredScope,
    allowed,
    reason,
  });
};

const requireScope = (requiredScope) => {
  return (req, res, next) => {
    const scopes = Array.isArray(req.user?.scopes) ? req.user.scopes : parseScopes(req.user?.scope || req.user?.claims?.scope);
    const allowed = hasRequiredScopes(scopes, [requiredScope]);

    logScopeAuthorization({
      req,
      requiredScope,
      scopes,
      allowed,
      reason: allowed ? "required_scope_present" : "required_scope_missing",
    });

    if (!allowed) {
      return res.status(403).json({
        error: "Forbidden",
        message: `Missing required Logto scope: ${requiredScope}`,
        requiredScope,
        detectedScopes: scopes,
      });
    }

    return next();
  };
};

const requireOrganizationAccess = ({ requiredScopes = [] } = {}) => {
  return async (req, res, next) => {
    try {
      const token = getTokenFromHeader(req.headers);
      const decodedPayload = decodeJwtPayload(token);
      const audience = decodedPayload.aud;
      const organizationId = extractOrganizationId(decodedPayload);

      if (!audience || !organizationId) {
        const error = new Error("Invalid organization token");
        error.status = 401;
        throw error;
      }

      const payload = await verifyJwt(token, audience);
      const verifiedOrganizationId = extractOrganizationId(payload);
      const scopes = parseScopes(payload.scope);

      if (!verifiedOrganizationId) {
        const error = new Error("Organization token is missing organization context");
        error.status = 401;
        throw error;
      }

      if (req.params?.organizationId && req.params.organizationId !== verifiedOrganizationId) {
        return res.status(403).json({
          error: "Forbidden",
          message: "Organization token does not match requested organization",
        });
      }

      if (!hasRequiredScopes(scopes, requiredScopes)) {
        return res.status(403).json({
          error: "Forbidden",
          message: "Insufficient organization permissions",
          requiredScopes,
        });
      }

      req.user = {
        id: payload.sub,
        sub: payload.sub,
        scopes,
        organizationId: verifiedOrganizationId,
        claims: payload,
      };

      return next();
    } catch (error) {
      const message = error instanceof joseErrors.JWTExpired ? "Organization token expired" : "Invalid organization access token";
      return res.status(error.status || 401).json({ error: "Unauthorized", message });
    }
  };
};

module.exports = {
  decodeJwtPayload,
  extractOrganizationId,
  getTokenFromHeader,
  hasRequiredScopes,
  parseScopes,
  requireAuth,
  requireOrganizationAccess,
  requireScope,
  verifyJwt,
};
