import type { MeResponse } from "../api/me";
import { RBACMatrix, evaluateCapabilityRule, type AccessIntent, type ActionKey, type CapabilityKey } from "./rbacMatrix";

export type { AccessIntent, ActionKey, CapabilityKey } from "./rbacMatrix";

export type AuthorizationCapabilities = Record<CapabilityKey, boolean> & {
  scopes: string[];
  roles: string[];
  globalRoles: string[];
  organizationRoles: string[];
  organizationId: string | null;
  owner: { canReadOwner: boolean; canWriteOwner: boolean };
};

export const capabilityMatrix = RBACMatrix.capabilities;

export function deriveAuthorizationCapabilities(me?: MeResponse): AuthorizationCapabilities {
  const entries = Object.entries(RBACMatrix.capabilities).map(([key, rule]) => [key, evaluateCapabilityRule(rule, me)]);
  return {
    ...(Object.fromEntries(entries) as Record<CapabilityKey, boolean>),
    scopes: me?.auth?.scopes ?? [],
    roles: me?.auth?.roles ?? [],
    globalRoles: me?.auth?.globalRoles ?? [],
    organizationRoles: me?.auth?.organizationRoles ?? [],
    organizationId: me?.auth?.organizationId ?? null,
    owner: { canReadOwner: Boolean(me?.auth?.owner?.canReadOwner), canWriteOwner: Boolean(me?.auth?.owner?.canWriteOwner) },
  };
}

export const getActionCapability = (action: ActionKey): CapabilityKey | undefined => {
  for (const screen of Object.values(RBACMatrix.screens) as Array<{ actions?: Partial<Record<ActionKey, CapabilityKey>> }>) {
    const capability = screen.actions?.[action];
    if (capability) return capability;
  }
  return undefined;
};

export const hasCapability = (capabilities: AuthorizationCapabilities, capability?: CapabilityKey) => Boolean(capability && capabilities[capability]);
export const canRead = (capabilities: AuthorizationCapabilities, capability: CapabilityKey) => hasCapability(capabilities, capability);
export const canWrite = (capabilities: AuthorizationCapabilities, capability: CapabilityKey) => hasCapability(capabilities, capability);
export const canExecute = (capabilities: AuthorizationCapabilities, action: ActionKey) => hasCapability(capabilities, getActionCapability(action));
export const canDelete = (capabilities: AuthorizationCapabilities, action: ActionKey) => hasCapability(capabilities, getActionCapability(action));
export const canManage = (capabilities: AuthorizationCapabilities, capability: CapabilityKey) => hasCapability(capabilities, capability);

export const canPerform = (capabilities: AuthorizationCapabilities, intent: AccessIntent, target: CapabilityKey | ActionKey) => {
  if (intent === "execute" || intent === "delete") return hasCapability(capabilities, getActionCapability(target as ActionKey));
  return hasCapability(capabilities, target as CapabilityKey);
};
