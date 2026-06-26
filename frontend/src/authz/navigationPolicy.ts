import { appRoutes } from "../navigation/routes";
import type { CapabilityKey } from "./capabilities";
export const menuCapabilities: Record<string, CapabilityKey> = {
  [appRoutes.owner.path]: "canSeeOwnerMenu",
  [appRoutes.ownerOrganizations.path]: "canSeeOrganizations",
  [appRoutes.selectOrganization.path]: "canSelectOrganization",
  [appRoutes.ownerLogs.path]: "canViewAudit",
  [appRoutes.ownerSystem.path]: "canViewSystem",
  [appRoutes.ownerBranding.path]: "canManageBranding",
  [appRoutes.ownerRoleMapping.path]: "canManageRoleMappings",
  [appRoutes.account.path]: "canViewAccount",
};
