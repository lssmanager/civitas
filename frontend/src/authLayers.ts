export const GLOBAL_OWNER_SCOPES = [
  "owner:read",
  "owner:write",
] as const;

export const ORGANIZATION_BOOTSTRAP_ADMIN_ROLE = "Admin-org" as const;

const GLOBAL_SCOPE_SET = new Set<string>(GLOBAL_OWNER_SCOPES);

export function assertNoOrganizationRolesInGlobalOwnerScopes() {
  if (GLOBAL_SCOPE_SET.has(ORGANIZATION_BOOTSTRAP_ADMIN_ROLE)) {
    throw new Error(
      `${ORGANIZATION_BOOTSTRAP_ADMIN_ROLE} is an organization role and must not be requested as a global owner scope`
    );
  }
}

export const ORGANIZATION_JIT_DEFAULT_ROLE = "Student-org" as const;
