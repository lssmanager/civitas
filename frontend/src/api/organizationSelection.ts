import { useMemo } from "react";
import { useApi } from "./base";
import type { OwnerOrganization } from "./owner";

export type OrganizationReconciliationStatus = "linked" | "name_matched_pending_link" | "metadata_missing" | "conflict" | string;

export type SelectableOrganization = OwnerOrganization & {
  logtoOrganizationId: string;
  syncStatus: "synced" | "pending" | "error" | "metadata_missing" | "conflict" | string;
  syncError: string | null;
  reconciliation: {
    status: OrganizationReconciliationStatus;
    profileCount: number;
    matchedBy: "logto_organization_id" | "name" | null | string;
    profileIds: string[];
  };
};

export type OrganizationSelectionResponse = {
  organizations: SelectableOrganization[];
  unreconciledProfiles: NonNullable<OwnerOrganization["profile"]>[];
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
