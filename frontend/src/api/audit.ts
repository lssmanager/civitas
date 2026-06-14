import { useMemo } from "react";
import { useApi } from "./base";

export type AuditLogResult = "success" | "failure" | "denied";

export type AuditLog = {
  id: string;
  actorUserId: string | null;
  organizationId: string | null;
  action: string;
  result: AuditLogResult;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ListOwnerAuditLogsParams = {
  limit?: number;
  offset?: number;
};

export type ListOwnerAuditLogsResponse = {
  auditLogs: AuditLog[];
  pagination: {
    limit: number;
    offset: number;
    count: number;
  };
};

export const useAuditApi = () => {
  const { fetchWithToken } = useApi();

  return useMemo(
    () => ({
      listOwnerAuditLogs: async ({ limit = 25, offset = 0 }: ListOwnerAuditLogsParams = {}): Promise<ListOwnerAuditLogsResponse> => {
        const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
        return fetchWithToken(`/owner/audit?${params.toString()}`);
      },
    }),
    [fetchWithToken]
  );
};
