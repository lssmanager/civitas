import { useMemo } from "react";
import { type InternalUser } from "./me";
import { useApi } from "./base";

export type OwnerScope = {
  organizations: boolean;
  memberships: false;
  rbac: false;
};

export type OwnerMeResponse = {
  owner: InternalUser;
  scope: OwnerScope;
};

export type Organization = {
  id: string;
  name: string;
  type: "school" | "district" | "community" | "other";
  status: "active" | "inactive" | "archived";
  subdomain: string;
  seatTotal: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateOrganizationPayload = {
  name: string;
  type: Organization["type"];
  subdomain: string;
  seatTotal: number;
};

export type OrganizationsResponse = {
  organizations: Organization[];
};

export type CreateOrganizationResponse = {
  organization: Organization;
};

export const useOwnerApi = () => {
  const { fetchWithToken } = useApi();

  return useMemo(
    () => ({
      getOwnerMe: async (): Promise<OwnerMeResponse> => fetchWithToken("/owner/me"),
      listOrganizations: async (): Promise<OrganizationsResponse> => fetchWithToken("/owner/organizations"),
      createOrganization: async (payload: CreateOrganizationPayload): Promise<CreateOrganizationResponse> =>
        fetchWithToken("/owner/organizations", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
    }),
    [fetchWithToken]
  );
};
