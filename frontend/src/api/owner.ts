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
  logtoOrganization?: Record<string, unknown> | null;
  profile: {
    id: string;
    logtoOrganizationId: string | null;
    nameCache: string | null;
    type: string | null;
    status: string;
    subdomain: string | null;
    slug?: string | null;
    adminDomain?: string | null;
    branding?: { logoUrl: string | null; faviconUrl: string | null; primaryColor: string | null; primaryColorDark: string | null; };
    organizationLoginExperienceEnabled?: boolean;
    defaultRoleNames?: string[];
    oidcApplicationId?: string | null;
    oidcInitialConfig?: Record<string, unknown> | null;
    oidcApplicationSecretConfigured?: boolean;
    emailDomainProvisioningStatus?: string;
    settings?: Record<string, unknown> | null;
    seatTotal: number;
    logtoSyncStatus: "pending" | "logto_created" | "metadata_linked" | "base_admin_invitation_pending" | "base_member_pending" | "base_role_pending" | "bootstrap_incomplete" | "bootstrapped" | "synced" | "error" | string;
    logtoSyncError: string | null;
    logtoSyncedAt: string | null;
    fluentcrmCompanyId: string | null;
    fluentcrmSyncStatus: "not_linked" | "linked" | "pending" | "conflict" | "error" | string;
    fluentcrmSyncError: string | null;
    fluentcrmSyncedAt: string | null;
    createdAt?: string;
    updatedAt?: string;
  } | null;
};


export type OwnerAuditActor = {
  internalUserId: string | null;
  logtoUserId: string | null;
  email: string | null;
  displayName: string | null;
};

export type OwnerAuditOrganization = {
  id: string | null;
  name: string | null;
};

export type OwnerAuditLog = {
  id: string;
  actorUserId: string | null;
  actor?: OwnerAuditActor;
  organizationId: string | null;
  organization?: OwnerAuditOrganization;
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

export type OwnerOrganizationTemplateRole = { id: string; name: string };

export type OwnerOrganizationTemplate = {
  roles: OwnerOrganizationTemplateRole[];
  requiredRoleNames: string[];
  missingRoleNames: string[];
  ready: boolean;
};

export type FluentCrmCompanyInput = {
  companyName?: string;
  companyEmail?: string;
  companyPhone?: string;
  about?: string;
  website?: string;
  numberOfEmployees?: number;
  industry?: string;
  type?: string;
  companyOwner?: string;
  description?: string;
};

export type CreateOwnerOrganizationInput = {
  name: string;
  description?: string;
  type?: string;
  subdomain?: string;
  seatTotal?: number;
  slug?: string;
  adminDomain?: string;
  logoUrl?: string;
  faviconUrl?: string;
  baseAdmin?: { name?: string; email?: string; logtoUserId?: string; initialOrganizationRole?: string };
  jitProvisioning?: { domain?: string; defaultRoleNames?: string[] };
  settings?: Record<string, unknown>;
  crm?: FluentCrmCompanyInput;
};

export const useOwnerApi = () => {
  const { fetchWithToken } = useApi();

  return useMemo(
    () => ({
      getOwnerMe: async (): Promise<OwnerMeResponse> => fetchWithToken("/owner/me"),
      getOrganizations: async (): Promise<{ organizations: OwnerOrganization[] }> => fetchWithToken("/owner/organizations"),
      getOrganizationTemplate: async (): Promise<OwnerOrganizationTemplate> => fetchWithToken("/owner/organization-template"),
      getAuditLogs: async (pagination: OwnerAuditPagination = {}): Promise<OwnerAuditResponse> => {
        const params = new URLSearchParams();
        if (pagination.limit !== undefined) params.set("limit", String(pagination.limit));
        if (pagination.offset !== undefined) params.set("offset", String(pagination.offset));
        const query = params.toString();
        return fetchWithToken(`/owner/audit${query ? `?${query}` : ""}`);
      },
      createOrganization: async (data: CreateOwnerOrganizationInput): Promise<{ organization: OwnerOrganization; status: string; sourceOfTruth: "logto"; adminAssignment?: { status: string; message?: string; logtoUserId?: string; roleName?: string }; jitProvisioning?: { status: string; domain?: string; defaultRoleNames?: string[] }; steps?: Record<string, unknown>; fluentcrm?: Record<string, unknown>; warning?: string }> =>
        fetchWithToken("/owner/organizations", { method: "POST", body: JSON.stringify(data) }),
      updateOrganizationFluentCrm: async (organizationId: string, crm: FluentCrmCompanyInput): Promise<{ status: string; fluentcrm?: Record<string, unknown> }> =>
        fetchWithToken(`/owner/organizations/${encodeURIComponent(organizationId)}/fluentcrm`, { method: "PATCH", body: JSON.stringify({ crm }) }),
    }),
    [fetchWithToken]
  );
};
