import { GLOBAL_OWNER_SCOPES } from "../authConfig";
import { useSession, type SessionContextValue } from "../session/sessionContext";

export type OwnerAuthorizationContext = {
  owner: {
    logtoUserId: string;
    internalUserId: string;
    authorizedBy: "logto_scope";
    requiredScope: "owner:read";
    scopes: string[];
  };
};

export const OWNER_REQUIRED_SCOPE = GLOBAL_OWNER_SCOPES[0];

export const devOwnerMe: OwnerAuthorizationContext = {
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
    return {
      owner: {
        logtoUserId: "",
        internalUserId: "",
        authorizedBy: "logto_scope",
        requiredScope: OWNER_REQUIRED_SCOPE,
        scopes: [],
      },
    };
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
