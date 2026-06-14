const { index, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } = require("drizzle-orm/pg-core");

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

const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    type: varchar("type", { length: 32 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("active"),
    subdomain: varchar("subdomain", { length: 63 }).notNull(),
    seatTotal: integer("seat_total").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    nameUniqueIdx: uniqueIndex("organizations_name_unique").on(table.name),
    subdomainUniqueIdx: uniqueIndex("organizations_subdomain_unique").on(table.subdomain),
    statusIdx: index("organizations_status_idx").on(table.status),
    typeIdx: index("organizations_type_idx").on(table.type),
  })
);

module.exports = {
  healthChecks,
  organizations,
  users,
};
