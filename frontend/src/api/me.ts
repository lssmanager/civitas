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

export type AuthMetadata = {
  sub?: string;
  issuer?: string;
  audience?: string | string[];
  scopes?: string[];
  organizationId?: string | null;
};

export type MeResponse = {
  user: InternalUser;
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
