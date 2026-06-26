import type { CapabilityKey } from "./capabilities";
export const actionCapabilities = {
  ownerBrandingSave: "canManageBranding",
  ownerRoleMappingSave: "canManageRoleMappings",
  organizationProfileSave: "canEditOrganizationProfile",
  organizationMembersWrite: "canManageMembers",
} as const satisfies Record<string, CapabilityKey>;
