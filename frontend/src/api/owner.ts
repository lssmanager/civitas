import { useMemo } from "react";
import { type InternalUser } from "./me";
import { useApi } from "./base";

export type OwnerScope = {
  organizations: false;
  memberships: false;
  rbac: false;
};

export type OwnerMeResponse = {
  owner: InternalUser;
  scope: OwnerScope;
};

export const useOwnerApi = () => {
  const { fetchWithToken } = useApi();

  return useMemo(
    () => ({
      getOwnerMe: async (): Promise<OwnerMeResponse> => fetchWithToken("/owner/me"),
    }),
    [fetchWithToken]
  );
};
