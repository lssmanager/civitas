const { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } = require("drizzle-orm/pg-core");

const healthChecks = pgTable("health_checks", {
  id: uuid("id").defaultRandom().primaryKey(),
  service: varchar("service", { length: 64 }).notNull().default("civitas-api"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
});

const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    logtoUserId: varchar("logto_user_id", { length: 255 }).notNull().unique(),
    email: varchar("email", { length: 320 }),
    status: varchar("status", { length: 32 }).notNull().default("active"),
    // Legacy product metadata only. Logto RBAC scopes authorize owner access.
    globalRole: text("global_role"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailIdx: index("users_email_idx").on(table.email),
    globalRoleIdx: index("users_global_role_idx").on(table.globalRole),
  })
);

const crmRoleMappings = pgTable(
  "crm_role_mappings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    logtoRoleId: varchar("logto_role_id", { length: 255 }).notNull().unique(),
    organizationRoleName: varchar("organization_role_name", { length: 255 }),
    roleNameCache: varchar("role_name_cache", { length: 255 }),
    tagsJson: jsonb("tags_json").notNull().default([]),
    listsJson: jsonb("lists_json").notNull().default([]),
    fluentcrmTags: jsonb("fluentcrm_tags").notNull().default([]),
    fluentcrmLists: jsonb("fluentcrm_lists").notNull().default([]),
    roleType: varchar("role_type", { length: 64 }).notNull().default("organizational"),
    isActive: boolean("is_active").notNull().default(true),
    source: varchar("source", { length: 32 }).notNull().default("gui_override"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    logtoRoleIdx: uniqueIndex("crm_role_mappings_logto_role_id_unique").on(table.logtoRoleId),
    roleNameIdx: index("crm_role_mappings_role_name_idx").on(table.organizationRoleName),
    roleNameCacheIdx: index("crm_role_mappings_role_name_cache_idx").on(table.roleNameCache),
    activeIdx: index("crm_role_mappings_active_idx").on(table.isActive),
  })
);

const wordpressRoleMappings = pgTable(
  "wordpress_role_mappings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    logtoRoleId: varchar("logto_role_id", { length: 255 }).notNull().unique(),
    organizationRoleName: varchar("organization_role_name", { length: 255 }).notNull(),
    wordpressRoleSlug: varchar("wordpress_role_slug", { length: 255 }).notNull().default(""),
    wordpressRoleName: varchar("wordpress_role_name", { length: 255 }).notNull().default(""),
    isActive: boolean("is_active").notNull().default(true),
    source: varchar("source", { length: 32 }).notNull().default("gui_override"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    logtoRoleIdx: uniqueIndex("wordpress_role_mappings_logto_role_id_unique").on(table.logtoRoleId),
    roleNameIdx: index("wordpress_role_mappings_role_name_idx").on(table.organizationRoleName),
    wordpressRoleIdx: index("wordpress_role_mappings_wp_role_idx").on(table.wordpressRoleSlug),
    activeIdx: index("wordpress_role_mappings_active_idx").on(table.isActive),
  })
);

const organizationProfiles = pgTable(
  "organization_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    logtoOrganizationId: varchar("logto_organization_id", { length: 255 }).unique(),
    nameCache: varchar("name_cache", { length: 255 }),
    type: varchar("type", { length: 64 }),
    status: varchar("status", { length: 32 }).notNull().default("active"),
    subdomain: varchar("subdomain", { length: 255 }).unique(),
    slug: varchar("slug", { length: 128 }).unique(),
    adminDomain: varchar("admin_domain", { length: 255 }),
    logoUrl: text("logo_url"),
    faviconUrl: text("favicon_url"),
    primaryColor: varchar("primary_color", { length: 32 }),
    primaryColorDark: varchar("primary_color_dark", { length: 32 }),
    organizationLoginExperienceEnabled: boolean("organization_login_experience_enabled").notNull().default(false),
    defaultRoleNames: jsonb("default_role_names"),
    oidcApplicationId: varchar("oidc_application_id", { length: 255 }),
    oidcInitialConfig: jsonb("oidc_initial_config"),
    oidcApplicationSecretRef: text("oidc_application_secret_ref"),
    emailDomainProvisioningStatus: varchar("email_domain_provisioning_status", { length: 32 }).notNull().default("not_requested"),
    settings: jsonb("settings"),
    seatTotal: integer("seat_total").notNull().default(0),
    logtoSyncStatus: varchar("logto_sync_status", { length: 32 }).notNull().default("pending"),
    logtoSyncError: text("logto_sync_error"),
    logtoSyncedAt: timestamp("logto_synced_at", { withTimezone: true }),
    fluentcrmCompanyId: varchar("fluentcrm_company_id", { length: 255 }),
    fluentcrmSyncStatus: varchar("fluentcrm_sync_status", { length: 32 }).notNull().default("not_linked"),
    fluentcrmSyncError: text("fluentcrm_sync_error"),
    fluentcrmSyncedAt: timestamp("fluentcrm_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    logtoOrganizationIdx: index("organization_profiles_logto_org_idx").on(table.logtoOrganizationId),
    statusIdx: index("organization_profiles_status_idx").on(table.status),
    slugIdx: index("organization_profiles_slug_idx").on(table.slug),
    adminDomainIdx: index("organization_profiles_admin_domain_idx").on(table.adminDomain),
    logtoSyncStatusIdx: index("organization_profiles_logto_sync_status_idx").on(table.logtoSyncStatus),
    fluentcrmCompanyIdx: index("organization_profiles_fluentcrm_company_idx").on(table.fluentcrmCompanyId),
    fluentcrmSyncStatusIdx: index("organization_profiles_fluentcrm_sync_status_idx").on(table.fluentcrmSyncStatus),
  })
);

const commercialEvents = pgTable(
  "commercial_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: varchar("event_id", { length: 255 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    source: varchar("source", { length: 64 }).notNull().default("wordpress_fluentcrm"),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("received"),
    organizationProfileId: uuid("organization_profile_id").references(() => organizationProfiles.id, { onDelete: "set null" }),
    logtoOrganizationId: varchar("logto_organization_id", { length: 255 }),
    seatDelta: integer("seat_delta"),
    commercialStatusAfter: varchar("commercial_status_after", { length: 32 }),
    logtoChangeSummary: jsonb("logto_change_summary"),
    sanitizedPayload: jsonb("sanitized_payload"),
    errorSummary: text("error_summary"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    eventIdUniqueIdx: uniqueIndex("commercial_events_event_id_unique").on(table.eventId),
    idempotencyIdx: index("commercial_events_idempotency_idx").on(table.idempotencyKey),
    statusIdx: index("commercial_events_status_idx").on(table.status),
    logtoOrganizationIdx: index("commercial_events_logto_org_idx").on(table.logtoOrganizationId),
  })
);

const syncOperations = pgTable(
  "sync_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operationType: varchar("operation_type", { length: 128 }).notNull(),
    entityType: varchar("entity_type", { length: 64 }).notNull(),
    entityId: varchar("entity_id", { length: 255 }),
    logtoOrganizationId: varchar("logto_organization_id", { length: 255 }),
    logtoUserId: varchar("logto_user_id", { length: 255 }),
    status: varchar("status", { length: 32 }).notNull().default("queued"),
    canonicalStatus: varchar("canonical_status", { length: 32 }).notNull().default("pending"),
    downstreamStatus: varchar("downstream_status", { length: 32 }).notNull().default("pending"),
    correlationId: varchar("correlation_id", { length: 255 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    payloadSnapshotJson: jsonb("payload_snapshot_json").notNull().default({}),
    resultSnapshotJson: jsonb("result_snapshot_json").notNull().default({}),
    lastErrorJson: jsonb("last_error_json"),
    retryCount: integer("retry_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    operationTypeIdx: index("sync_operations_operation_type_idx").on(table.operationType),
    entityIdx: index("sync_operations_entity_idx").on(table.entityType, table.entityId),
    logtoOrganizationIdx: index("sync_operations_logto_org_idx").on(table.logtoOrganizationId),
    statusIdx: index("sync_operations_status_idx").on(table.status),
    correlationIdx: index("sync_operations_correlation_idx").on(table.correlationId),
    idempotencyIdx: uniqueIndex("sync_operations_idempotency_unique").on(table.idempotencyKey),
  })
);

const syncOperationSteps = pgTable(
  "sync_operation_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operationId: uuid("operation_id").notNull().references(() => syncOperations.id, { onDelete: "cascade" }),
    stepName: varchar("step_name", { length: 128 }).notNull(),
    queueName: varchar("queue_name", { length: 128 }).notNull(),
    jobId: varchar("job_id", { length: 255 }),
    attempt: integer("attempt").notNull().default(1),
    status: varchar("status", { length: 32 }).notNull().default("queued"),
    outputJson: jsonb("output_json"),
    lastErrorJson: jsonb("last_error_json"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    operationIdx: index("sync_operation_steps_operation_idx").on(table.operationId),
    stepIdx: index("sync_operation_steps_step_idx").on(table.stepName),
    statusIdx: index("sync_operation_steps_status_idx").on(table.status),
    jobIdx: index("sync_operation_steps_job_idx").on(table.queueName, table.jobId),
    attemptUniqueIdx: uniqueIndex("sync_operation_steps_attempt_unique").on(table.operationId, table.stepName, table.attempt),
  })
);



const organizationBootstrapOperations = pgTable(
  "organization_bootstrap_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    logtoOrganizationId: varchar("logto_organization_id", { length: 255 }),
    organizationProfileId: uuid("organization_profile_id").references(() => organizationProfiles.id, { onDelete: "set null" }),
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    payloadSnapshot: jsonb("payload_snapshot").notNull(),
    stepResults: jsonb("step_results"),
    lastError: jsonb("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    actorUserIdx: index("organization_bootstrap_operations_actor_user_idx").on(table.actorUserId),
    logtoOrganizationIdx: index("organization_bootstrap_operations_logto_org_idx").on(table.logtoOrganizationId),
    statusIdx: index("organization_bootstrap_operations_status_idx").on(table.status),
    createdAtIdx: index("organization_bootstrap_operations_created_at_idx").on(table.createdAt),
  })
);

const organizationBootstrapMicroRequests = pgTable(
  "organization_bootstrap_micro_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentOperationId: uuid("parent_operation_id").notNull().references(() => organizationBootstrapOperations.id, { onDelete: "cascade" }),
    logtoOrganizationId: varchar("logto_organization_id", { length: 255 }),
    microRequestType: varchar("micro_request_type", { length: 128 }).notNull(),
    targetEntityType: varchar("target_entity_type", { length: 64 }).notNull(),
    targetEntityId: varchar("target_entity_id", { length: 255 }),
    sourceStep: varchar("source_step", { length: 64 }),
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    payloadSnapshot: jsonb("payload_snapshot"),
    lastError: jsonb("last_error"),
    retryCount: integer("retry_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    parentOperationIdx: index("organization_bootstrap_micro_requests_parent_idx").on(table.parentOperationId),
    logtoOrganizationIdx: index("organization_bootstrap_micro_requests_logto_org_idx").on(table.logtoOrganizationId),
    statusIdx: index("organization_bootstrap_micro_requests_status_idx").on(table.status),
    typeIdx: index("organization_bootstrap_micro_requests_type_idx").on(table.microRequestType),
    targetIdx: index("organization_bootstrap_micro_requests_target_idx").on(table.targetEntityType, table.targetEntityId),
  })
);

const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    organizationId: varchar("organization_id", { length: 255 }),
    action: varchar("action", { length: 128 }).notNull(),
    result: varchar("result", { length: 32 }).notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    actorUserIdx: index("audit_logs_actor_user_idx").on(table.actorUserId),
    organizationIdx: index("audit_logs_organization_idx").on(table.organizationId),
    actionIdx: index("audit_logs_action_idx").on(table.action),
    createdAtIdx: index("audit_logs_created_at_idx").on(table.createdAt),
  })
);

module.exports = {
  auditLogs,
  commercialEvents,
  crmRoleMappings,
  healthChecks,
  organizationBootstrapMicroRequests,
  organizationBootstrapOperations,
  organizationProfiles,
  syncOperationSteps,
  syncOperations,
  users,
  wordpressRoleMappings,
};
