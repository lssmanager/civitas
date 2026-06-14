const { index, integer, pgTable, text, timestamp, uuid, varchar } = require("drizzle-orm/pg-core");

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
    // Deprecated legacy metadata only. Logto RBAC scopes are the authorization source of truth.
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
    logtoOrganizationId: varchar("logto_organization_id", { length: 255 }).notNull().unique(),
    nameCache: varchar("name_cache", { length: 255 }),
    type: varchar("type", { length: 64 }),
    status: varchar("status", { length: 32 }).notNull().default("active"),
    subdomain: varchar("subdomain", { length: 255 }).unique(),
    seatTotal: integer("seat_total").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    logtoOrganizationIdx: index("organization_profiles_logto_org_idx").on(table.logtoOrganizationId),
    statusIdx: index("organization_profiles_status_idx").on(table.status),
  })
);

module.exports = {
  healthChecks,
  organizationProfiles,
  users,
};
