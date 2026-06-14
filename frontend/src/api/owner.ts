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
  logtoOrganizationId: string | null;
  name: string | null;
  profile: {
    id: string;
    logtoOrganizationId: string | null;
    nameCache: string | null;
    type: string | null;
    status: string;
    subdomain: string | null;
    seatTotal: number;
    logtoSyncStatus: "pending" | "synced" | "error" | string;
    logtoSyncError: string | null;
    logtoSyncedAt: string | null;
    createdAt?: string;
    updatedAt?: string;
  } | null;
};


export type OwnerAuditLog = {
  id: string;
  actorUserId: string | null;
  organizationId: string | null;
  action: string;
  result: "success" | "error" | "denied" | string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type OwnerAuditResponse = {
  auditLogs: OwnerAuditLog[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
};

export type OwnerAuditPagination = {
  limit?: number;
  offset?: number;
};

export type CreateOwnerOrganizationInput = {
  name: string;
  description?: string;
  type?: string;
  subdomain?: string;
  seatTotal?: number;
};

export const useOwnerApi = () => {
  const { fetchWithToken } = useApi();

  return useMemo(
    () => ({
      getOwnerMe: async (): Promise<OwnerMeResponse> => fetchWithToken("/owner/me"),
      getOrganizations: async (): Promise<{ organizations: OwnerOrganization[] }> => fetchWithToken("/owner/organizations"),
      getAuditLogs: async (pagination: OwnerAuditPagination = {}): Promise<OwnerAuditResponse> => {
        const params = new URLSearchParams();
        if (pagination.limit !== undefined) params.set("limit", String(pagination.limit));
        if (pagination.offset !== undefined) params.set("offset", String(pagination.offset));
        const query = params.toString();
        return fetchWithToken(`/owner/audit${query ? `?${query}` : ""}`);
      },
      createOrganization: async (data: CreateOwnerOrganizationInput): Promise<{ organization: OwnerOrganization }> =>
        fetchWithToken("/owner/organizations", { method: "POST", body: JSON.stringify(data) }),
    }),
    [fetchWithToken]
  );
};
