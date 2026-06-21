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

export type OwnerCommercialStatus = {
  organizationId: string | null;
  profileId: string;
  seatTotal: number;
  seatsConsumed: number;
  seatsAvailable: number;
  commercial: Record<string, unknown> | null;
};

export type OwnerMemberDeprovisionResponse = {
  status: "deprovisioned" | "deprovisioned_fluentcrm_failed" | string;
  logto: { membership: "removed" | "already_absent" | string; globalRolesMutated: boolean };
  fluentcrm: {
    status: "completed" | "failed" | string;
    strategy: "hard_delete" | "dissociate_only" | "no_contact_found" | "duplicate_conflict" | string;
    message?: string;
    operations?: unknown[];
  };
};

export type OwnerOrganizationTemplateRole = { id: string; name: string };

export type OwnerCrmRoleMapping = {
  logtoRoleId: string;
  organizationRoleName: string;
  tags: string[];
  lists: string[];
  roleType: string;
  isActive: boolean;
  source: string;
  isCustomized: boolean;
};

export type OwnerCrmRoleMappingsResponse = {
  roles: OwnerOrganizationTemplateRole[];
  mappings: OwnerCrmRoleMapping[];
  effectiveSource: string;
  envWarning?: string | null;
  warnings?: string[];
  unmappedRoles?: OwnerOrganizationTemplateRole[];
  note: string;
};

export type OwnerWordPressRole = {
  slug: string;
  name: string;
  description?: string;
  source?: string;
};

export type OwnerWordPressRoleMapping = {
  logtoRoleId: string;
  organizationRoleName: string;
  wordpressRoleSlug: string;
  wordpressRoleName: string;
  isActive: boolean;
  source: string;
  isCustomized: boolean;
};

export type OwnerWordPressRoleMappingsResponse = {
  roles: OwnerOrganizationTemplateRole[];
  wordpressRoles: OwnerWordPressRole[];
  mappings: OwnerWordPressRoleMapping[];
  effectiveSource: string;
  warnings?: string[];
  note: string;
};

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
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  numberOfEmployees?: number;
  industry?: string;
  type?: string;
  companyOwner?: string;
  description?: string;
  nit?: number;
  verificationDigit?: number;
  tags?: string[];
  lists?: string[];
};

export type OwnerFluentCrmHealthResponse = {
  integration: "fluentcrm";
  status: "ok" | "error";
  baseUrl?: string;
  endpoint?: string;
  timeoutMs?: number;
  message?: string;
  code?: string | null;
  diagnostic?: {
    code?: string;
    message?: string;
    likelyCauses?: string[];
  } | null;
  details?: Record<string, unknown> | null;
};


export type OwnerBootstrapMicroRequest = {
  id: string;
  parentOperationId: string;
  logtoOrganizationId: string | null;
  microRequestType: string;
  targetEntityType: string;
  targetEntityId: string | null;
  sourceStep?: string | null;
  status: string;
  payloadSnapshot?: Record<string, unknown> | null;
  lastError?: Record<string, unknown> | null;
  retryCount: number;
  createdAt?: string;
  updatedAt?: string;
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
  baseAdmin?: { firstName?: string; lastName?: string; name?: string; email?: string; phone?: string; username?: string; logtoUserId?: string; initialOrganizationRole?: string };
  jitProvisioning?: { domain?: string; defaultRoleNames?: string[] };
  settings?: Record<string, unknown>;
  crm?: FluentCrmCompanyInput;
  administrativeContacts?: Array<{ kind?: string; name: string; email: string; phone?: string; position?: string; organizationRoleName: string }>;
};

export const useOwnerApi = () => {
  const { fetchWithToken } = useApi();

  return useMemo(
    () => ({
      getOwnerMe: async (): Promise<OwnerMeResponse> => fetchWithToken("/owner/me"),
      getOrganizations: async (): Promise<{ organizations: OwnerOrganization[] }> => fetchWithToken("/owner/organizations"),
      getBootstrapMicroRequests: async (): Promise<{ microRequests: OwnerBootstrapMicroRequest[] }> => fetchWithToken("/owner/bootstrap/micro-requests"),
      retryBootstrapMicroRequest: async (microRequestId: string): Promise<{ microRequest: OwnerBootstrapMicroRequest; status: string; note?: string }> =>
        fetchWithToken(`/owner/bootstrap/micro-requests/${encodeURIComponent(microRequestId)}/retry`, { method: "POST" }),
      getOrganizationTemplate: async (): Promise<OwnerOrganizationTemplate> => fetchWithToken("/owner/organization-template"),
      getFluentCrmHealth: async (): Promise<OwnerFluentCrmHealthResponse> => fetchWithToken("/owner/integrations/fluentcrm/health"),
      getFluentCrmRoleMappings: async (): Promise<OwnerCrmRoleMappingsResponse> => fetchWithToken("/owner/integrations/fluentcrm/role-mappings"),
      updateFluentCrmRoleMappings: async (mappings: OwnerCrmRoleMapping[]): Promise<OwnerCrmRoleMappingsResponse> =>
        fetchWithToken("/owner/integrations/fluentcrm/role-mappings", { method: "PUT", body: JSON.stringify({ mappings }) }),
      resetFluentCrmRoleMappings: async (): Promise<OwnerCrmRoleMappingsResponse> =>
        fetchWithToken("/owner/integrations/fluentcrm/role-mappings/reset", { method: "POST" }),
      getWordPressRoles: async (): Promise<{ roles: OwnerWordPressRole[]; note: string }> => fetchWithToken("/owner/integrations/wordpress/roles"),
      getWordPressRoleMappings: async (): Promise<OwnerWordPressRoleMappingsResponse> => fetchWithToken("/owner/integrations/wordpress/role-mappings"),
      updateWordPressRoleMappings: async (mappings: OwnerWordPressRoleMapping[]): Promise<OwnerWordPressRoleMappingsResponse> =>
        fetchWithToken("/owner/integrations/wordpress/role-mappings", { method: "PUT", body: JSON.stringify({ mappings }) }),
      resetWordPressRoleMappings: async (): Promise<OwnerWordPressRoleMappingsResponse> =>
        fetchWithToken("/owner/integrations/wordpress/role-mappings/reset", { method: "POST" }),
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
      syncOrganizationFluentCrmContacts: async (organizationId: string): Promise<{ contactSync: { status: string; total: number; succeeded: number; failed: number; conflicts: number; errors?: unknown[] } }> =>
        fetchWithToken(`/owner/organizations/${encodeURIComponent(organizationId)}/fluentcrm/sync-contacts`, { method: "POST" }),
      getOrganizationFluentCrmSyncStatus: async (organizationId: string): Promise<{ contactSync: Record<string, unknown> | null; syncStatus: string; syncError: string | null; syncedAt: string | null }> =>
        fetchWithToken(`/owner/organizations/${encodeURIComponent(organizationId)}/fluentcrm/sync-status`),
      getOrganizationCommercialStatus: async (organizationId: string): Promise<OwnerCommercialStatus> =>
        fetchWithToken(`/owner/organizations/${encodeURIComponent(organizationId)}/commercial-status`),
      deprovisionOrganizationMember: async (organizationId: string, logtoUserId: string): Promise<OwnerMemberDeprovisionResponse> =>
        fetchWithToken(`/owner/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(logtoUserId)}/deprovision`, { method: "POST" }),
    }),
    [fetchWithToken]
  );
};