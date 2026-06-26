import { useMemo } from "react";
import { useApi } from "./base";

export type OwnerAuthorization = {
  logtoUserId: string;
  internalUserId: string;
  authorizedBy: "logto_global_role_and_scope" | "logto_scope";
  requiredScope: "owner:read";
  requiredWriteScope?: "owner:write";
  canReadOwner: boolean;
  canWriteOwner: boolean;
  globalRoles: string[];
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
    /** @deprecated Compatibility alias for appSubdomain. */
    subdomain: string | null;
    appSubdomain?: string | null;
    appBaseDomain?: string | null;
    entryUrl?: string | null;
    entryUrlInconsistency?: string | null;
    /** @deprecated Historical/display-only; never functional for URLs or routing. */
    slug?: string | null;
    adminDomain?: string | null;
    branding?: { logoUrl: string | null; faviconUrl: string | null; primaryColor: string | null; primaryColorDark: string | null; lightLogoUrl?: string | null; darkLogoUrl?: string | null; lightMarkUrl?: string | null; darkMarkUrl?: string | null; lightFaviconUrl?: string | null; darkFaviconUrl?: string | null; lightPrimaryColor?: string | null; darkPrimaryColor?: string | null; };
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

export type OwnerOperationsSummary = {
  counts: { queued: number; running: number; partialFailed: number; failed: number; retryable: number; organizationsWithPendingDownstreamSync: number };
  functionalHealth: { status: string; severity: "success" | "warning" | "critical" | string; message: string; code: string };
  incidents: Array<{ type: string; organizationId: string | null; organizationName: string | null; message: string; retryable: boolean }>;
  organizations: Array<{ organizationId: string | null; profileId: string; name: string | null; bootstrapStatus: string; canonicalStatus: string; downstreamStatus: string; currentStep: string; lastFunctionalError: string | null; retryable: boolean; conflictType: string | null }>;
};

export type OwnerWorkerHealth = {
  readiness: string;
  worker: { heartbeatAt: string | null; heartbeatStale: boolean; source?: string };
  redis: { status: string };
  queues: Array<{ name: string; waiting: number; active: number; delayed: number; failed: number; oldestJobAgeSeconds: number }>;
};
export type OwnerIntegrationHealthCheck = { key: string; label: string; system: string; required?: boolean; status: string; severity: string; message: string; checkedAt: string; details?: Record<string, unknown> | null; nextAction?: string | null };
export type OwnerIntegrationsHealth = { checkedAt: string; status: string; checks: OwnerIntegrationHealthCheck[] };

export type OwnerInstrumentationStatus = "live" | "sampled" | "derived" | "not_instrumented" | "proposed" | string;
export type OwnerSystemMetric = { value: number | string | null; unit: string; instrumentationStatus: OwnerInstrumentationStatus; source: string; window: string; updatedAt: string; note?: string };
export type OwnerSystemMetricsResponse = {
  checkedAt: string;
  status: string;
  note?: string;
  persistence: { status: string; source: string; note: string };
  cacheAnalytics: { hitMissRatio: OwnerSystemMetric; hits: OwnerSystemMetric; misses: OwnerSystemMetric; prefetchHit: OwnerSystemMetric; coldMiss: OwnerSystemMetric; stale: OwnerSystemMetric };
  latencyAndTiming: { pingLatency: OwnerSystemMetric; avg: OwnerSystemMetric; p95: OwnerSystemMetric; p99: OwnerSystemMetric };
  bytesAndSerialization: { avgKeySize: OwnerSystemMetric; rawVsCompressed: OwnerSystemMetric; compressionRatio: OwnerSystemMetric };
  callsAndThroughput: { redisCommandsProcessed: OwnerSystemMetric; redisCommandsPerMinute: OwnerSystemMetric; bullmqJobsPerMinute: OwnerSystemMetric; totalBullmqCompleted: OwnerSystemMetric };
  debugAndLogging: { redisOps: OwnerSystemMetric; bullmqJobs: OwnerSystemMetric; failedJobs: OwnerSystemMetric; retryRate: OwnerSystemMetric; slowQueries: OwnerSystemMetric };
  expansion: { redisMemory: { usedMemory: OwnerSystemMetric; usedMemoryPeak: OwnerSystemMetric; evictedKeys: OwnerSystemMetric; expiredKeys: OwnerSystemMetric }; ttlDistribution: OwnerSystemMetric; retryRate: OwnerSystemMetric; throughput24h: OwnerSystemMetric; perOrganization: OwnerSystemMetric; alerts: OwnerSystemMetric };
  series?: { last8?: Array<{ at: string; redisCommandsPerMinute: number | null; bullmqJobsPerMinute: number | null; sampleWindowMinutes: number }>; throughput24h?: Array<{ at: string; redisCommandsPerMinute: number | null; bullmqJobsPerMinute: number | null; sampleCount: number }>; rollup?: Record<string, unknown> | null };
};

export type OwnerPendingSync = {
  id: string;
  operationId: string;
  organizationId: string | null;
  organizationName: string | null;
  type: string;
  affectedSystem: string;
  entityType?: string | null;
  targetIdentity?: string | null;
  stepName?: string | null;
  status: string;
  retryable: boolean;
  lastError: string;
  humanMessage?: string | null;
  suggestedAction: string;
  providerCode?: string | null;
  providerStatus?: string | number | null;
  queueName?: string | null;
  jobId?: string | null;
  retryState?: string | null;
  enqueuedAt?: string | null;
  lastAttemptAt?: string | null;
  workerHeartbeatState?: string | null;
  jobAgeSeconds?: number | null;
};
export type OwnerOrganizationEvent = { id: string; at: string | null; type: string; result: string; stage: string; message: string; requiresAction: boolean; retryOperationId: string | null; stepName?: string | null; entityType?: string | null; targetIdentity?: string | null; queueName?: string | null; jobId?: string | null; retryState?: string | null; workerHeartbeatState?: string | null; jobAgeSeconds?: number | null };
export type OwnerOrganizationProfileResponse = {
  organization: OwnerOrganization;
  canonical: { source: "logto"; topLevelFields: string[]; customData: Record<string, unknown> };
  readModel?: { business?: Record<string, string | null>; contact?: Record<string, string | null>; branding?: Record<string, string | null>; crm?: Record<string, unknown>; sourcePriority?: string[] };
  customDataShape: { root: string; sections: string[] };
  downstreamOnly: string[];
  sync: { pending: OwnerPendingSync[]; events: OwnerOrganizationEvent[]; summary?: { logto: string; fluentcrmCompany: string; fluentcrmContact: string; lastStep: string | null; lastRetry: string | null; queueName: string | null; jobId: string | null; jobAgeSeconds: number | null; workerHeartbeatState: string | null } };
};
export type OwnerOrganizationDirectoryMember = {
  identity: { logtoUserId: string | null; primerNombre?: string | null; segundoNombre?: string | null; primerApellido?: string | null; segundoApellido?: string | null; name: string | null; email: string | null; phone: string | null; roles?: string[]; lastLoginAt?: string | null; mfa?: { enabled: boolean | null; method?: string | null; availability?: string }; sessions?: { availability: string; note?: string }; spentTime?: { availability: string; value: number | null; note?: string } };
  crm: Record<string, unknown>;
  civitas: Record<string, unknown>;
};
export type OwnerOrganizationDirectoryResponse = { organizationId: string; members: OwnerOrganizationDirectoryMember[] };

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


/** @deprecated Legacy bootstrap micro-requests are not an active owner operational source; use sync_operations / sync_operation_steps projections instead. */
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
  /** @deprecated Legacy input alias. New creation flows must send appSubdomain. */
  subdomain?: string;
  appSubdomain?: string;
  appBaseDomain?: string;
  seatTotal?: number;
  /** @deprecated Historical/display-only; not part of the active creation contract. */
  slug?: string;
  adminDomain?: string;
  logoUrl?: string;
  faviconUrl?: string;
  jitProvisioning?: { domain?: string; defaultRoleNames?: string[] };
  settings?: Record<string, unknown>;
  crm?: FluentCrmCompanyInput;
  administrativeContacts?: Array<{ kind?: string; firstName?: string; middleName?: string; firstSurname?: string; secondSurname?: string; primerNombre?: string; segundoNombre?: string; primerApellido?: string; segundoApellido?: string; name: string; email: string; phone?: string; phoneExtension?: string; position?: string; organizationRoleName: string }>;
};

export const useOwnerApi = () => {
  const { fetchWithToken } = useApi();

  return useMemo(
    () => ({
      getOwnerMe: async (): Promise<OwnerMeResponse> => fetchWithToken("/owner/me"),
      getOrganizations: async (): Promise<{ organizations: OwnerOrganization[] }> => fetchWithToken("/owner/organizations"),
      /** @deprecated Legacy compatibility endpoint; active owner UI must use getOrganizationProfile().sync or operations summary. */
      getBootstrapMicroRequests: async (): Promise<{ microRequests: OwnerBootstrapMicroRequest[] }> => fetchWithToken("/owner/bootstrap/micro-requests"),
      /** @deprecated Legacy compatibility endpoint; active retries must use retrySyncOperation(). */
      retryBootstrapMicroRequest: async (microRequestId: string): Promise<{ microRequest: OwnerBootstrapMicroRequest; status: string; note?: string }> =>
        fetchWithToken(`/owner/bootstrap/micro-requests/${encodeURIComponent(microRequestId)}/retry`, { method: "POST" }),
      getOrganizationTemplate: async (): Promise<OwnerOrganizationTemplate> => fetchWithToken("/owner/organization-template"),
      getOperationsSummary: async (): Promise<OwnerOperationsSummary> => fetchWithToken("/owner/operations/summary"),
      getWorkerHealth: async (): Promise<OwnerWorkerHealth> => fetchWithToken("/owner/system/worker-health"),
      getIntegrationsHealth: async (): Promise<OwnerIntegrationsHealth> => fetchWithToken("/owner/system/integrations-health"),
      getSystemMetrics: async (): Promise<OwnerSystemMetricsResponse> => fetchWithToken("/owner/system/metrics"),
      getOrganizationProfile: async (organizationId: string): Promise<OwnerOrganizationProfileResponse> =>
        fetchWithToken(`/owner/organizations/${encodeURIComponent(organizationId)}/profile`),
      updateOrganizationProfile: async (organizationId: string, data: Record<string, unknown>): Promise<{ status: string; organization: OwnerOrganization; syncOperation: Record<string, unknown> }> =>
        fetchWithToken(`/owner/organizations/${encodeURIComponent(organizationId)}/profile`, { method: "PATCH", body: JSON.stringify(data) }),
      retrySyncOperation: async (organizationId: string, operationId: string): Promise<{ status: string; operation: Record<string, unknown> }> =>
        fetchWithToken(`/owner/organizations/${encodeURIComponent(organizationId)}/sync-operations/${encodeURIComponent(operationId)}/retry`, { method: "POST" }),
      getOrganizationMembers: async (organizationId: string): Promise<OwnerOrganizationDirectoryResponse> =>
        fetchWithToken(`/owner/organizations/${encodeURIComponent(organizationId)}/directory`),
      createOrganizationMember: async (organizationId: string, data: { firstName: string; middleName?: string | null; firstSurname: string; secondSurname?: string | null; email: string; phone?: string | null; phoneExtension?: string | null; position?: string | null; organizationRoleName: string }): Promise<{ status: string; syncOperation: Record<string, unknown> }> =>
        fetchWithToken(`/owner/organizations/${encodeURIComponent(organizationId)}/members`, { method: "POST", body: JSON.stringify(data) }),
      updateOrganizationMember: async (organizationId: string, logtoUserId: string, data: { firstName?: string | null; middleName?: string | null; firstSurname?: string | null; secondSurname?: string | null; email?: string | null; phone?: string | null; previousEmail?: string | null }): Promise<{ status: string; logtoUser: Record<string, unknown>; syncOperation: Record<string, unknown> }> =>
        fetchWithToken(`/owner/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(logtoUserId)}`, { method: "PATCH", body: JSON.stringify(data) }),
      resetOrganizationMemberPassword: async (organizationId: string, logtoUserId: string): Promise<{ status: string; message: string }> =>
        fetchWithToken(`/owner/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(logtoUserId)}/reset-password`, { method: "POST" }),
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
      createOrganization: async (data: CreateOwnerOrganizationInput): Promise<{ operationId?: string; status: string; statusUrl?: string; canonicalStatus?: string; downstreamStatus?: string; correlationId?: string; organizationId?: string | null; jobId?: string; sourceOfTruth: "logto"; message?: string; organization?: OwnerOrganization; adminAssignment?: { status: string; message?: string; logtoUserId?: string; roleName?: string }; jitProvisioning?: { status: string; domain?: string; defaultRoleNames?: string[] }; steps?: Record<string, unknown>; fluentcrm?: Record<string, unknown>; warning?: string }> =>
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
