import { useMemo } from "react";
import { useApi } from "./base";

export type OwnerAuthorization = {
  logtoUserId: string;
  internalUserId: string;
  authorizedBy: "logto_scope";
  requiredScope: "owner:read";
  scopes: string[];
};

export type OwnerMeResponse = {
  owner: OwnerAuthorization;
};

export type OwnerOrganization = {
  logtoOrganizationId: string;
  name: string | null;
  profile: {
    id: string;
    logtoOrganizationId: string;
    nameCache: string | null;
    type: string | null;
    status: string;
    subdomain: string | null;
    seatTotal: number;
  } | null;
};

export const useOwnerApi = () => {
  const { fetchWithToken } = useApi();

  return useMemo(
    () => ({
      getOwnerMe: async (): Promise<OwnerMeResponse> => fetchWithToken("/owner/me"),
      getOrganizations: async (): Promise<{ organizations: OwnerOrganization[] }> => fetchWithToken("/owner/organizations"),
    }),
    [fetchWithToken]
  );
};
