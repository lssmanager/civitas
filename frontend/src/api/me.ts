import { useMemo } from "react";
import { useApi } from "./base";

export type InternalUser = {
  id: string;
  logtoUserId: string;
  email: string | null;
  status: "active" | "blocked" | "inactive" | string;
  globalRole: "owner_global" | string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MeResponse = {
  user: InternalUser;
  auth?: {
    sub?: string;
    issuer?: string;
    audience?: string | string[];
    scopes?: string[];
  };
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
