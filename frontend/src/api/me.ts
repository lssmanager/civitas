import { useMemo } from "react";
import { APP_ENV } from "../env";
import { useApi } from "./base";

export type InternalUser = {
  id: string;
  logtoUserId: string;
  email: string | null;
  status: "active" | "blocked" | "inactive" | string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SessionIdentity = {
  internalUserId: string | null;
  logtoUserId: string | null;
  email: string | null;
  displayName: string | null;
  username: string | null;
};

export type OwnerCapabilities = {
  canReadOwner: boolean;
  canWriteOwner: boolean;
  globalRoles: string[];
  scopes: string[];
};

export type AuthMetadata = {
  sub?: string;
  issuer?: string;
  audience?: string | string[];
  scopes?: string[];
  roles?: string[];
  globalRoles?: string[];
  organizationRoles?: string[];
  organizationId?: string | null;
  owner?: OwnerCapabilities;
  token?: {
    issuedAt: string | null;
    expiresAt: string | null;
    permissionFreshness: string;
  };
};

export type MeResponse = {
  user: InternalUser;
  identity?: SessionIdentity;
  auth?: AuthMetadata;
};

export type MeProfileResponse = {
  identity: Record<string, unknown>;
  authorization?: AuthMetadata;
  sourcePolicy?: { identity: string; authorization: string; canonicalSource: string };
  fetchedAt: string;
};

export const useMeApi = () => {
  const { fetchWithToken } = useApi();

  return useMemo(
    () => ({
      getMe: async (): Promise<MeResponse> => fetchWithToken("/me", { timeoutMs: APP_ENV.api.sessionBootstrapTimeoutMs }),
      getMeProfile: async (): Promise<MeProfileResponse> => fetchWithToken("/me/profile"),
    }),
    [fetchWithToken]
  );
};
