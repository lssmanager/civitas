import { useMemo } from "react";
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

export type AuthMetadata = {
  sub?: string;
  issuer?: string;
  audience?: string | string[];
  scopes?: string[];
  organizationId?: string | null;
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

export const useMeApi = () => {
  const { fetchWithToken } = useApi();

  return useMemo(
    () => ({
      getMe: async (): Promise<MeResponse> => fetchWithToken("/me"),
    }),
    [fetchWithToken]
  );
};
