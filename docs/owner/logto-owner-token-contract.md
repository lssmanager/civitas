# Logto owner token contract

Civitas treats Logto as the canonical authority for identity, global roles, API permissions, organizations, and memberships. PostgreSQL must not duplicate `owner_global` as a local authorization flag.

## Root cause

The owner portal requires two independent signals in the global Civitas API access token:

1. a verifiable global role assignment: `owner_global`; and
2. the API scopes for the requested operation: `owner:read` for read-only requests and both `owner:read owner:write` for mutating requests.

Logto access tokens for global API resources include the requested API audience and granted permissions/scopes, but role names are not guaranteed to be present as token claims. If the user has `owner_global` in Logto and the token only contains scopes such as `owner:read`, Civitas correctly refuses `/owner/...` because it cannot verify the required global role from the signed token.

## Required token shape

Owner portal requests must use a global JWT access token for the Civitas API resource, not an organization token.

Required built-in claims:

- `aud`: the exact value of `LOGTO_API_RESOURCE_INDICATOR` / `VITE_API_RESOURCE_INDICATOR`, for example `https://civitas.socialstudies.cloud/api`.
- `scope`: includes `owner:read` for read-only routes; includes `owner:read owner:write` for mutations.
- No organization context: the token must not include `organization_id`, `organizationId`, or an audience value prefixed with `urn:logto:organization:`.

Required custom role claim:

- Preferred: `https://civitas.socialstudies.cloud/claims/global_roles: ["owner_global"]`.
- Backward-compatible accepted claim names: `global_roles`, `globalRoles`, `role_names`, `roles`, `https://civitas.socialstudies.cloud/global_roles`, `https://civitas.socialstudies.cloud/claims/role_names`, and `https://civitas.socialstudies.cloud/role_names`.

The preferred namespaced claim avoids collision with built-in or third-party `roles` semantics while keeping the role value itself canonical in Logto.

## Recommended Logto Custom JWT script

Create or update the **User access token** Custom JWT script for the Civitas API resource so it emits the preferred claim only for global API tokens. Logto's current Custom JWT runtime calls `getCustomJwtClaims` with a single object argument (`{ token, context, environmentVariables, api }`). For user access tokens, the real context sample exposes global role assignments at `context.user.roles`, where each role has `id`, `name`, `description`, and `scopes`; organization-scoped roles are exposed separately at `context.user.organizationRoles` and must not be used for owner authorization.

The script below is executable in Logto's Custom JWT editor and in the editor's test runner when the test context includes `context.user.roles` with a role named `owner_global`.

```js
const CIVITAS_API_AUDIENCE = 'https://civitas.socialstudies.cloud/api';
const GLOBAL_ROLES_CLAIM = 'https://civitas.socialstudies.cloud/claims/global_roles';
const ORGANIZATION_AUDIENCE_PREFIX = 'urn:logto:organization:';

const asArray = (value) => Array.isArray(value) ? value : [];

const roleName = (role) => {
  if (typeof role === 'string') return role;
  return typeof role?.name === 'string' ? role.name : null;
};

const getAudienceValues = (audience) => Array.isArray(audience) ? audience : [audience].filter(Boolean);

const getCustomJwtClaims = async ({ token, context, environmentVariables, api }) => {
  const audience = getAudienceValues(token?.aud);
  const organizationAudience = audience.some((value) =>
    typeof value === 'string' && value.startsWith(ORGANIZATION_AUDIENCE_PREFIX)
  );

  if (!audience.includes(CIVITAS_API_AUDIENCE) || organizationAudience) {
    return {};
  }

  const globalRoles = asArray(context?.user?.roles)
    .map(roleName)
    .filter(Boolean);

  return {
    [GLOBAL_ROLES_CLAIM]: [...new Set(globalRoles)],
  };
};
```

Minimal Logto Custom JWT test data:

```json
{
  "token": {
    "aud": "https://civitas.socialstudies.cloud/api",
    "scope": "owner:read organizations:read organizations:create",
    "kind": "AccessToken"
  },
  "context": {
    "user": {
      "id": "user_owner",
      "roles": [
        {
          "id": "role_owner",
          "name": "owner_global",
          "description": "Global Civitas owner",
          "scopes": []
        }
      ],
      "organizationRoles": []
    }
  },
  "environmentVariables": {}
}
```

Expected test result:

```json
{
  "https://civitas.socialstudies.cloud/claims/global_roles": ["owner_global"]
}
```

If the same script is tested with `token.aud` set to `urn:logto:organization:<organization-id>`, it must return `{}` so organization tokens cannot satisfy `/owner/*`.

After changing roles or the custom token script, force the browser to obtain a new access token: sign out/sign in, clear the SDK token cache, or wait for the current access token to expire and refresh. Existing JWTs do not change after issuance.

## Frontend contract

Civitas owner API calls request a global access token with `getAccessToken(VITE_API_RESOURCE_INDICATOR)`. They must not pass an organization id into the shared API client for `/owner/...`; passing an organization id intentionally switches to `getOrganizationToken()` and the backend will reject that token on owner routes.

## Backend enforcement

The backend verifies the token against `LOGTO_API_RESOURCE_INDICATOR`, rejects organization-scoped tokens in `requireOwner`, verifies the presence of `owner_global` in accepted global role claims, and then enforces owner scopes by HTTP method. Scopes alone are not sufficient for owner access.
