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

Create or update the Logto custom access token claims script for the Civitas API resource so it emits the preferred claim only for global API tokens. The script shape below is intentionally defensive because Logto custom JWT test payloads and Management API payloads can expose roles under different property names depending on version and configuration.

```js
const CIVITAS_API_AUDIENCE = 'https://civitas.socialstudies.cloud/api';
const GLOBAL_ROLES_CLAIM = 'https://civitas.socialstudies.cloud/claims/global_roles';

const asList = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean);
  return [];
};

const roleName = (role) => {
  if (typeof role === 'string') return role;
  return role?.name ?? role?.roleName ?? role?.key ?? null;
};

const extractGlobalRoleNames = (data) => [
  ...asList(data?.user?.roles),
  ...asList(data?.user?.role_names),
  ...asList(data?.user?.global_roles),
  ...asList(data?.roles),
  ...asList(data?.role_names),
  ...asList(data?.global_roles),
]
  .map(roleName)
  .filter(Boolean);

async function getCustomJwtClaims(token, data, envVariables) {
  const audience = Array.isArray(token?.aud) ? token.aud : [token?.aud];
  const organizationAudience = audience.some((value) =>
    typeof value === 'string' && value.startsWith('urn:logto:organization:')
  );

  if (!audience.includes(CIVITAS_API_AUDIENCE) || organizationAudience) {
    return {};
  }

  return {
    [GLOBAL_ROLES_CLAIM]: [...new Set(extractGlobalRoleNames(data))],
  };
}
```

After changing roles or the custom token script, force the browser to obtain a new access token: sign out/sign in, clear the SDK token cache, or wait for the current access token to expire and refresh. Existing JWTs do not change after issuance.

## Frontend contract

Civitas owner API calls request a global access token with `getAccessToken(VITE_API_RESOURCE_INDICATOR)`. They must not pass an organization id into the shared API client for `/owner/...`; passing an organization id intentionally switches to `getOrganizationToken()` and the backend will reject that token on owner routes.

## Backend enforcement

The backend verifies the token against `LOGTO_API_RESOURCE_INDICATOR`, rejects organization-scoped tokens in `requireOwner`, verifies the presence of `owner_global` in accepted global role claims, and then enforces owner scopes by HTTP method. Scopes alone are not sufficient for owner access.
