import type { MeResponse } from "../api/me";

export type CapabilityKey =
  | "canSeeOwnerMenu" | "canSeeOrganizations" | "canManageBranding" | "canManageRoleMappings"
  | "canViewAudit" | "canViewSystem" | "canEditOrganizationProfile" | "canManageMembers"
  | "canReadOnlyOrganization" | "canSelectOrganization" | "canViewAccount";

export type AuthorizationCapabilities = Record<CapabilityKey, boolean> & {
  scopes: string[]; roles: string[]; globalRoles: string[]; organizationRoles: string[]; organizationId: string | null;
  owner: { canReadOwner: boolean; canWriteOwner: boolean };
};

type CapabilityRule = { owner?: "read" | "write"; organizationScopes?: string[]; organizationRoles?: string[]; globalScopes?: string[] };
const hasAll = (actual: string[], required: string[] = []) => required.every((item) => actual.includes(item));
const hasAny = (actual: string[], required: string[] = []) => required.length === 0 || required.some((item) => actual.includes(item));

export const capabilityMatrix: Record<CapabilityKey, CapabilityRule> = {
  canSeeOwnerMenu: { owner: "read" },
  canSeeOrganizations: { owner: "read" },
  canManageBranding: { owner: "write" },
  canManageRoleMappings: { owner: "write" },
  canViewAudit: { owner: "read" },
  canViewSystem: { owner: "read" },
  canEditOrganizationProfile: { owner: "write", organizationScopes: ["organization:write"], organizationRoles: ["admin"] },
  canManageMembers: { owner: "write", organizationScopes: ["organization:members:write"], organizationRoles: ["admin"] },
  canReadOnlyOrganization: { organizationScopes: ["organization:read"], organizationRoles: ["admin", "member"] },
  canSelectOrganization: { owner: "read", organizationScopes: ["organization:read"], organizationRoles: ["admin", "member"] },
  canViewAccount: {},
};

function evaluateRule(rule: CapabilityRule, me?: MeResponse): boolean {
  const auth = me?.auth;
  const scopes = auth?.scopes ?? [];
  const organizationRoles = auth?.organizationRoles ?? [];
  const owner = auth?.owner;
  if (!rule.owner && !rule.organizationScopes?.length && !rule.organizationRoles?.length && !rule.globalScopes?.length) return true;
  if (rule.owner === "read" && owner?.canReadOwner) return true;
  if (rule.owner === "write" && owner?.canWriteOwner) return true;
  if (rule.globalScopes?.length && hasAll(scopes, rule.globalScopes)) return true;
  if (auth?.organizationId && hasAny(organizationRoles, rule.organizationRoles) && hasAll(scopes, rule.organizationScopes)) return true;
  return false;
}

export function deriveAuthorizationCapabilities(me?: MeResponse): AuthorizationCapabilities {
  const entries = Object.keys(capabilityMatrix).map((key) => [key, evaluateRule(capabilityMatrix[key as CapabilityKey], me)]);
  return {
    ...(Object.fromEntries(entries) as Record<CapabilityKey, boolean>),
    scopes: me?.auth?.scopes ?? [], roles: me?.auth?.roles ?? [], globalRoles: me?.auth?.globalRoles ?? [], organizationRoles: me?.auth?.organizationRoles ?? [], organizationId: me?.auth?.organizationId ?? null,
    owner: { canReadOwner: Boolean(me?.auth?.owner?.canReadOwner), canWriteOwner: Boolean(me?.auth?.owner?.canWriteOwner) },
  };
}
