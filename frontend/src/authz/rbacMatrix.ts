import { appRoutes } from "../navigation/routes";
import type { MeResponse } from "../api/me";

export const OWNER_GLOBAL_ROLE = "owner_global";
export const OWNER_SCOPES = {
  read: "owner:read",
  write: "owner:write",
  manage: "owner:manage",
  organizationsCreate: "organizations:create",
  organizationsRead: "organizations:read",
} as const;

export type CapabilityKey =
  | "canViewOwnerConsole"
  | "canViewOrganizations"
  | "canCreateOrganizations"
  | "canViewOrganizationProfile"
  | "canEditOrganizationProfile"
  | "canManageOrganizationSettings"
  | "canManageMembers"
  | "canRetryOrganizationSync"
  | "canViewCommercialStatus"
  | "canManageIntegrations"
  | "canEditBranding"
  | "canManageRoleMappings"
  | "canViewAudit"
  | "canViewSystem"
  | "canManageSystemSettings"
  | "canSelectOrganization"
  | "canViewAccount";

export type ActionKey =
  | "owner.organization.create"
  | "owner.organization.profile.update"
  | "owner.organization.settings.update"
  | "owner.organization.member.create"
  | "owner.organization.member.update"
  | "owner.organization.member.password.reset"
  | "owner.organization.member.deprovision"
  | "owner.organization.sync.retry"
  | "owner.organization.commercial.sync"
  | "owner.integrations.manage"
  | "owner.branding.update"
  | "owner.roleMappings.update"
  | "owner.roleMappings.reset"
  | "owner.system.refresh"
  | "account.profile.load";

export type AccessIntent = "read" | "write" | "execute" | "delete" | "manage";

export type Rule = {
  requiredOwnerScopes?: string[];
  requiredOwnerAllScopes?: string[];
  requiredGlobalRoles?: string[];
  requiresOwnerRead?: boolean;
  requiresOwnerWrite?: boolean;
  requiresOrganizationContext?: boolean;
  requiredOrganizationScopes?: string[];
  requiredOrganizationRoles?: string[];
};

type ScreenPolicy = {
  path: string;
  visibility: CapabilityKey;
  route: CapabilityKey;
  read: CapabilityKey;
  write?: CapabilityKey;
  manage?: CapabilityKey;
  actions?: Partial<Record<ActionKey, CapabilityKey>>;
};

const OWNER_READ: Rule = { requiredGlobalRoles: [OWNER_GLOBAL_ROLE], requiredOwnerScopes: [OWNER_SCOPES.read], requiresOwnerRead: true };
const OWNER_WRITE: Rule = { requiredGlobalRoles: [OWNER_GLOBAL_ROLE], requiredOwnerScopes: [OWNER_SCOPES.write], requiresOwnerWrite: true };
const OWNER_ORGANIZATIONS_READ: Rule = { requiredGlobalRoles: [OWNER_GLOBAL_ROLE], requiredOwnerScopes: [OWNER_SCOPES.organizationsRead, OWNER_SCOPES.read], requiresOwnerRead: true };
const OWNER_ORGANIZATIONS_CREATE: Rule = { requiredGlobalRoles: [OWNER_GLOBAL_ROLE], requiredOwnerScopes: [OWNER_SCOPES.organizationsCreate, OWNER_SCOPES.write], requiresOwnerWrite: true };
const ANY_AUTHENTICATED: Rule = {};

export const RBACMatrix = {
  // Current validated phase: global owner. Tenant-scoped rules below are extension points only.
  capabilities: {
    canViewOwnerConsole: OWNER_READ,
    canViewOrganizations: OWNER_ORGANIZATIONS_READ,
    canCreateOrganizations: OWNER_ORGANIZATIONS_CREATE,
    canViewOrganizationProfile: OWNER_ORGANIZATIONS_READ,
    canEditOrganizationProfile: OWNER_WRITE,
    canManageOrganizationSettings: OWNER_WRITE,
    canManageMembers: OWNER_WRITE,
    canRetryOrganizationSync: OWNER_WRITE,
    canViewCommercialStatus: OWNER_ORGANIZATIONS_READ,
    canManageIntegrations: OWNER_WRITE,
    canEditBranding: OWNER_WRITE,
    canManageRoleMappings: OWNER_WRITE,
    canViewAudit: OWNER_READ,
    canViewSystem: OWNER_READ,
    canManageSystemSettings: OWNER_WRITE,
    canSelectOrganization: OWNER_ORGANIZATIONS_READ,
    canViewAccount: ANY_AUTHENTICATED,
  } satisfies Record<CapabilityKey, Rule>,
  screens: {
    owner: { path: appRoutes.owner.path, visibility: "canViewOwnerConsole", route: "canViewOwnerConsole", read: "canViewOwnerConsole" },
    ownerOrganizations: { path: appRoutes.ownerOrganizations.path, visibility: "canViewOrganizations", route: "canViewOrganizations", read: "canViewOrganizations", write: "canCreateOrganizations", actions: { "owner.organization.create": "canCreateOrganizations" } },
    ownerOrganizationProfile: { path: "/owner/organizations/:organizationId", visibility: "canViewOrganizationProfile", route: "canViewOrganizationProfile", read: "canViewOrganizationProfile", write: "canEditOrganizationProfile", manage: "canManageMembers", actions: { "owner.organization.profile.update": "canEditOrganizationProfile", "owner.organization.member.create": "canManageMembers", "owner.organization.member.update": "canManageMembers", "owner.organization.member.password.reset": "canManageMembers", "owner.organization.member.deprovision": "canManageMembers", "owner.organization.sync.retry": "canRetryOrganizationSync" } },
    ownerOrganizationSettings: { path: "/owner/organizations/:organizationId/settings", visibility: "canManageOrganizationSettings", route: "canManageOrganizationSettings", read: "canViewOrganizationProfile", write: "canManageOrganizationSettings", manage: "canManageOrganizationSettings", actions: { "owner.organization.settings.update": "canManageOrganizationSettings", "owner.organization.commercial.sync": "canManageIntegrations", "owner.integrations.manage": "canManageIntegrations" } },
    ownerLogs: { path: appRoutes.ownerLogs.path, visibility: "canViewAudit", route: "canViewAudit", read: "canViewAudit" },
    ownerSystem: { path: appRoutes.ownerSystem.path, visibility: "canViewSystem", route: "canViewSystem", read: "canViewSystem", write: "canManageSystemSettings", actions: { "owner.system.refresh": "canViewSystem" } },
    ownerBranding: { path: appRoutes.ownerBranding.path, visibility: "canEditBranding", route: "canViewOwnerConsole", read: "canViewOwnerConsole", write: "canEditBranding", actions: { "owner.branding.update": "canEditBranding" } },
    ownerRoleMapping: { path: appRoutes.ownerRoleMapping.path, visibility: "canManageRoleMappings", route: "canViewOwnerConsole", read: "canViewOwnerConsole", write: "canManageRoleMappings", manage: "canManageRoleMappings", actions: { "owner.roleMappings.update": "canManageRoleMappings", "owner.roleMappings.reset": "canManageRoleMappings" } },
    selectOrganization: { path: appRoutes.selectOrganization.path, visibility: "canSelectOrganization", route: "canSelectOrganization", read: "canSelectOrganization" },
    account: { path: appRoutes.account.path, visibility: "canViewAccount", route: "canViewAccount", read: "canViewAccount", actions: { "account.profile.load": "canViewAccount" } },
  } satisfies Record<string, ScreenPolicy>,
} as const;

const hasAny = (actual: string[], required: string[] = []) => required.length === 0 || required.some((item) => actual.includes(item));
const hasAll = (actual: string[], required: string[] = []) => required.every((item) => actual.includes(item));

export const evaluateCapabilityRule = (rule: Rule, me?: MeResponse): boolean => {
  if (!me) return false;
  const auth = me.auth;
  if (!auth) return false;

  const scopes = auth.scopes ?? [];
  const globalRoles = auth.globalRoles ?? [];
  const organizationRoles = auth.organizationRoles ?? [];
  const organizationId = auth.organizationId ?? null;
  const owner = auth.owner;

  if (rule.requiredGlobalRoles?.length && !hasAll(globalRoles, rule.requiredGlobalRoles)) return false;
  if (rule.requiredOwnerScopes?.length && !hasAny(scopes, rule.requiredOwnerScopes)) return false;
  if (rule.requiredOwnerAllScopes?.length && !hasAll(scopes, rule.requiredOwnerAllScopes)) return false;
  if (rule.requiresOwnerRead && !owner?.canReadOwner && !hasAny(scopes, [OWNER_SCOPES.read])) return false;
  if (rule.requiresOwnerWrite && !owner?.canWriteOwner && !hasAny(scopes, [OWNER_SCOPES.write])) return false;

  // Future tenant-scoped extension point: organization role checks are prepared but not yet validated end-to-end.
  if (rule.requiresOrganizationContext && !organizationId) return false;
  if (rule.requiredOrganizationScopes?.length && !hasAny(scopes, rule.requiredOrganizationScopes)) return false;
  if (rule.requiredOrganizationRoles?.length && !hasAny(organizationRoles, rule.requiredOrganizationRoles)) return false;

  return true;
};
