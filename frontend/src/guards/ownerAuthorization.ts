import { GLOBAL_OWNER_SCOPES } from "../authLayers";
import { useSession, type SessionContextValue } from "../session/sessionContext";

export type OwnerAuthorizationContext = {
  owner: {
    logtoUserId: string;
    internalUserId: string;
    authorizedBy: "logto_global_role_and_scope";
    requiredScope: "owner:read";
    requiredWriteScope: "owner:write";
    canReadOwner: boolean;
    canWriteOwner: boolean;
    globalRoles: string[];
    scopes: string[];
  };
};

export const OWNER_REQUIRED_SCOPE = GLOBAL_OWNER_SCOPES[0];
export const OWNER_WRITE_SCOPE = GLOBAL_OWNER_SCOPES[1];

export const devOwnerMe: OwnerAuthorizationContext = {
  owner: {
    logtoUserId: "dev-logto-owner",
    internalUserId: "dev-owner",
    authorizedBy: "logto_global_role_and_scope",
    requiredScope: OWNER_REQUIRED_SCOPE,
    requiredWriteScope: OWNER_WRITE_SCOPE,
    canReadOwner: true,
    canWriteOwner: true,
    globalRoles: ["owner_global", "owner_write_global"],
    scopes: [OWNER_REQUIRED_SCOPE, OWNER_WRITE_SCOPE],
  },
};

export function getOwnerAuthorizationFromSession(me: SessionContextValue["me"]): OwnerAuthorizationContext {
  const scopes = Array.isArray(me?.auth?.owner?.scopes) ? me.auth.owner.scopes : Array.isArray(me?.auth?.scopes) ? me.auth.scopes : [];
  const globalRoles = Array.isArray(me?.auth?.owner?.globalRoles) ? me.auth.owner.globalRoles : [];

  return {
    owner: {
      logtoUserId: me?.user?.logtoUserId ?? "",
      internalUserId: me?.user?.id ?? "",
      authorizedBy: "logto_global_role_and_scope",
      requiredScope: OWNER_REQUIRED_SCOPE,
      requiredWriteScope: OWNER_WRITE_SCOPE,
      canReadOwner: Boolean(me?.auth?.owner?.canReadOwner),
      canWriteOwner: Boolean(me?.auth?.owner?.canWriteOwner),
      globalRoles,
      scopes,
    },
  };
}

export function useOwnerAuthorization() {
  const { me } = useSession();
  return getOwnerAuthorizationFromSession(me);
}
