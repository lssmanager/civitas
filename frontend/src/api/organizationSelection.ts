import { useMemo } from "react";
import { useApi } from "./base";
import type { OwnerOrganization } from "./owner";

export type SelectableOrganization = OwnerOrganization;

export type OrganizationSelectionResponse = {
  organizations: SelectableOrganization[];
};

export const useOrganizationSelectionApi = () => {
  const { fetchWithToken } = useApi();

  return useMemo(
    () => ({
      getOrganizations: async (): Promise<OrganizationSelectionResponse> => fetchWithToken("/organizations"),
    }),
    [fetchWithToken]
  );
};
