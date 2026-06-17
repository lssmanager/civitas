const { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } = require("drizzle-orm/pg-core");

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
  healthChecks,
  organizationProfiles,
  users,
};
