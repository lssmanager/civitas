import { useSession, type SessionContextValue } from "../session/SessionContext";

export type OwnerAuthorizationContext = {
  owner: {
    logtoUserId: string;
    internalUserId: string;
    authorizedBy: "logto_scope";
    requiredScope: "owner:read";
    scopes: string[];
  };
};

export const OWNER_REQUIRED_SCOPE = "owner:read";

const devOwnerMe: OwnerAuthorizationContext = {
  owner: {
    logtoUserId: "dev-logto-owner",
    internalUserId: "dev-owner",
    authorizedBy: "logto_scope",
    requiredScope: OWNER_REQUIRED_SCOPE,
    scopes: [OWNER_REQUIRED_SCOPE, "organizations:read", "organizations:create"],
  },
};

export function getOwnerAuthorizationFromSession(me: SessionContextValue["me"]): OwnerAuthorizationContext {
  const scopes = Array.isArray(me?.auth?.scopes) ? me.auth.scopes : [];

  if (!me?.user) {
    return devOwnerMe;
  }

  return {
    owner: {
      logtoUserId: me.user.logtoUserId,
      internalUserId: me.user.id,
      authorizedBy: "logto_scope",
      requiredScope: OWNER_REQUIRED_SCOPE,
      scopes,
    },
  };
}

export function useOwnerAuthorization() {
  const { me } = useSession();
  return getOwnerAuthorizationFromSession(me);
}
