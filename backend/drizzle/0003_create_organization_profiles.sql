CREATE TABLE IF NOT EXISTS "organization_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "logto_organization_id" varchar(255) NOT NULL,
  "name_cache" varchar(255),
  "type" varchar(64),
  "status" varchar(32) DEFAULT 'active' NOT NULL,
  "subdomain" varchar(255),
  "seat_total" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "organization_profiles_logto_organization_id_unique" UNIQUE("logto_organization_id"),
  CONSTRAINT "organization_profiles_subdomain_unique" UNIQUE("subdomain")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_profiles_logto_org_idx" ON "organization_profiles" USING btree ("logto_organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_profiles_status_idx" ON "organization_profiles" USING btree ("status");
