import { useMemo } from "react";
import { useSession } from "../session/sessionContext";
import { actionCapabilities } from "./actionPolicy";
import { canDelete, canExecute, canManage, canRead, canWrite, deriveAuthorizationCapabilities, type ActionKey, type CapabilityKey } from "./capabilities";

export function useAuthorization() {
  const { me } = useSession();
  const capabilities = useMemo(() => deriveAuthorizationCapabilities(me), [me]);
  return {
    capabilities,
    canRead: (capability: CapabilityKey) => canRead(capabilities, capability),
    canWrite: (capability: CapabilityKey) => canWrite(capabilities, capability),
    canExecute: (action: ActionKey) => canExecute(capabilities, action),
    canDelete: (action: ActionKey) => canDelete(capabilities, action),
    canManage: (capability: CapabilityKey) => canManage(capabilities, capability),
    actionCapabilities,
  };
}
