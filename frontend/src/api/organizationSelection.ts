import { useMemo } from "react";
import { useApi } from "./base";
import type { OwnerOrganization } from "./owner";

export type OrganizationReconciliationStatus = "linked" | "name_match_pending_link" | "local_profile_missing" | "ready_to_seed_profile" | "missing_required_profile_metadata" | "duplicate_local_profiles" | string;

export type CanonicalOrganizationFields = {
  name: string | null;
  customData: Record<string, unknown>;
  oidcRedirectUri: string | null;
  appSubdomain: string | null;
  slug: string | null;
  adminDomain: string | null;
  visibleSource: "logto" | string;
};

export type OrganizationReconciliationIncident = {
  type: string;
  policy: string;
  message: string;
  profile: NonNullable<OwnerOrganization["profile"]>;
};

export type SelectableOrganization = OwnerOrganization & {
  logtoOrganizationId: string;
  canonical: CanonicalOrganizationFields;
  syncStatus: "synced" | "pending" | "error" | "local_profile_missing" | "ready_to_seed_profile" | "missing_required_profile_metadata" | "duplicate_local_profiles" | string;
  syncError: string | null;
  reconciliation: {
    status: OrganizationReconciliationStatus;
    profileCount: number;
    matchedBy: "logto_organization_id" | "name" | null | string;
    profileIds: string[];
    canonicalProfileId: string | null;
    duplicateProfileIds: string[];
  };
};

export type ReconciliationTasksSummary = { pending: number; hitlRequired: number; failed: number };

export type OrganizationSelectionResponse = {
  organizations: SelectableOrganization[];
  reconciliationIncidents?: OrganizationReconciliationIncident[];
  unreconciledProfiles: NonNullable<OwnerOrganization["profile"]>[];
  reconciliationTasksSummary?: ReconciliationTasksSummary;
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
