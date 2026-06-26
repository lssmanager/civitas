import { appRoutes } from "../navigation/routes";
import type { MeResponse } from "../api/me";

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
  | "owner.organization.sync.retry"
  | "owner.organization.commercial.sync"
  | "owner.integrations.manage"
  | "owner.branding.update"
  | "owner.roleMappings.update"
  | "owner.roleMappings.reset"
  | "owner.system.refresh"
  | "account.profile.load";

export type AccessIntent = "read" | "write" | "execute" | "delete" | "manage";

type OwnerRequirement = "read" | "write";

type Rule = {
  owner?: OwnerRequirement;
  anyCapabilities?: CapabilityKey[];
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

const OWNER_READ: Rule = { owner: "read" };
const OWNER_WRITE: Rule = { owner: "write" };
const ANY_AUTHENTICATED: Rule = {};

export const RBACMatrix = {
  capabilities: {
    canViewOwnerConsole: OWNER_READ,
    canViewOrganizations: OWNER_READ,
    canCreateOrganizations: OWNER_WRITE,
    canViewOrganizationProfile: OWNER_READ,
    canEditOrganizationProfile: OWNER_WRITE,
    canManageOrganizationSettings: OWNER_WRITE,
    canManageMembers: OWNER_WRITE,
    canRetryOrganizationSync: OWNER_WRITE,
    canViewCommercialStatus: OWNER_READ,
    canManageIntegrations: OWNER_WRITE,
    canEditBranding: OWNER_WRITE,
    canManageRoleMappings: OWNER_WRITE,
    canViewAudit: OWNER_READ,
    canViewSystem: OWNER_READ,
    canManageSystemSettings: OWNER_WRITE,
    canSelectOrganization: OWNER_READ,
    canViewAccount: ANY_AUTHENTICATED,
  } satisfies Record<CapabilityKey, Rule>,
  screens: {
    owner: { path: appRoutes.owner.path, visibility: "canViewOwnerConsole", route: "canViewOwnerConsole", read: "canViewOwnerConsole" },
    ownerOrganizations: { path: appRoutes.ownerOrganizations.path, visibility: "canViewOrganizations", route: "canViewOrganizations", read: "canViewOrganizations", write: "canCreateOrganizations", actions: { "owner.organization.create": "canCreateOrganizations" } },
    ownerOrganizationProfile: { path: "/owner/organizations/:organizationId", visibility: "canViewOrganizationProfile", route: "canViewOrganizationProfile", read: "canViewOrganizationProfile", write: "canEditOrganizationProfile", manage: "canManageMembers", actions: { "owner.organization.profile.update": "canEditOrganizationProfile", "owner.organization.member.create": "canManageMembers", "owner.organization.member.update": "canManageMembers", "owner.organization.member.password.reset": "canManageMembers", "owner.organization.sync.retry": "canRetryOrganizationSync" } },
    ownerOrganizationSettings: { path: "/owner/organizations/:organizationId/settings", visibility: "canManageOrganizationSettings", route: "canManageOrganizationSettings", read: "canViewOrganizationProfile", write: "canManageOrganizationSettings", manage: "canManageOrganizationSettings", actions: { "owner.organization.settings.update": "canManageOrganizationSettings", "owner.organization.commercial.sync": "canViewCommercialStatus", "owner.integrations.manage": "canManageIntegrations" } },
    ownerLogs: { path: appRoutes.ownerLogs.path, visibility: "canViewAudit", route: "canViewAudit", read: "canViewAudit" },
    ownerSystem: { path: appRoutes.ownerSystem.path, visibility: "canViewSystem", route: "canViewSystem", read: "canViewSystem", write: "canManageSystemSettings", actions: { "owner.system.refresh": "canViewSystem" } },
    ownerBranding: { path: appRoutes.ownerBranding.path, visibility: "canEditBranding", route: "canViewOwnerConsole", read: "canViewOwnerConsole", write: "canEditBranding", actions: { "owner.branding.update": "canEditBranding" } },
    ownerRoleMapping: { path: appRoutes.ownerRoleMapping.path, visibility: "canManageRoleMappings", route: "canViewOwnerConsole", read: "canViewOwnerConsole", write: "canManageRoleMappings", manage: "canManageRoleMappings", actions: { "owner.roleMappings.update": "canManageRoleMappings", "owner.roleMappings.reset": "canManageRoleMappings" } },
    selectOrganization: { path: appRoutes.selectOrganization.path, visibility: "canSelectOrganization", route: "canSelectOrganization", read: "canSelectOrganization" },
    account: { path: appRoutes.account.path, visibility: "canViewAccount", route: "canViewAccount", read: "canViewAccount", actions: { "account.profile.load": "canViewAccount" } },
  } satisfies Record<string, ScreenPolicy>,
} as const;

export const evaluateCapabilityRule = (rule: Rule, me?: MeResponse): boolean => {
  if (!rule.owner && !rule.anyCapabilities?.length) return Boolean(me);
  if (rule.owner === "read" && me?.auth?.owner?.canReadOwner) return true;
  if (rule.owner === "write" && me?.auth?.owner?.canWriteOwner) return true;
  return false;
};
