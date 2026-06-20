-- Idempotent production repair for operational synchronization mappings.
-- Logto, WordPress and FluentCRM remain canonical for their own catalogs; these
-- tables store only Civitas mapping/state rows keyed by Logto role id.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "crm_role_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL
);

ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "logto_role_id" varchar(255);
ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "organization_role_name" varchar(255);
ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "role_name_cache" varchar(255);
ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "tags_json" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "lists_json" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "fluentcrm_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "fluentcrm_lists" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "role_type" varchar(64) DEFAULT 'organizational' NOT NULL;
ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true NOT NULL;
ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "source" varchar(32) DEFAULT 'gui_override' NOT NULL;
ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

UPDATE "crm_role_mappings" SET "organization_role_name" = COALESCE("organization_role_name", "role_name_cache") WHERE "organization_role_name" IS NULL;
UPDATE "crm_role_mappings" SET "role_name_cache" = COALESCE("role_name_cache", "organization_role_name") WHERE "role_name_cache" IS NULL;
UPDATE "crm_role_mappings" SET "tags_json" = COALESCE("tags_json", "fluentcrm_tags", '[]'::jsonb), "fluentcrm_tags" = COALESCE("fluentcrm_tags", "tags_json", '[]'::jsonb), "lists_json" = COALESCE("lists_json", "fluentcrm_lists", '[]'::jsonb), "fluentcrm_lists" = COALESCE("fluentcrm_lists", "lists_json", '[]'::jsonb);

DROP INDEX IF EXISTS "crm_role_mappings_logto_role_id_unique";
CREATE UNIQUE INDEX "crm_role_mappings_logto_role_id_unique" ON "crm_role_mappings" USING btree ("logto_role_id") WHERE "logto_role_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "crm_role_mappings_role_name_idx" ON "crm_role_mappings" USING btree ("organization_role_name");
CREATE INDEX IF NOT EXISTS "crm_role_mappings_role_name_cache_idx" ON "crm_role_mappings" USING btree ("role_name_cache");
CREATE INDEX IF NOT EXISTS "crm_role_mappings_active_idx" ON "crm_role_mappings" USING btree ("is_active");

CREATE TABLE IF NOT EXISTS "wordpress_role_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL
);
ALTER TABLE "wordpress_role_mappings" ADD COLUMN IF NOT EXISTS "logto_role_id" varchar(255);
ALTER TABLE "wordpress_role_mappings" ADD COLUMN IF NOT EXISTS "organization_role_name" varchar(255) DEFAULT '' NOT NULL;
ALTER TABLE "wordpress_role_mappings" ADD COLUMN IF NOT EXISTS "wordpress_role_slug" varchar(255) DEFAULT '' NOT NULL;
ALTER TABLE "wordpress_role_mappings" ADD COLUMN IF NOT EXISTS "wordpress_role_name" varchar(255) DEFAULT '' NOT NULL;
ALTER TABLE "wordpress_role_mappings" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true NOT NULL;
ALTER TABLE "wordpress_role_mappings" ADD COLUMN IF NOT EXISTS "source" varchar(32) DEFAULT 'gui_override' NOT NULL;
ALTER TABLE "wordpress_role_mappings" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "wordpress_role_mappings" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
DROP INDEX IF EXISTS "wordpress_role_mappings_logto_role_id_unique";
CREATE UNIQUE INDEX "wordpress_role_mappings_logto_role_id_unique" ON "wordpress_role_mappings" USING btree ("logto_role_id") WHERE "logto_role_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "wordpress_role_mappings_role_name_idx" ON "wordpress_role_mappings" USING btree ("organization_role_name");
CREATE INDEX IF NOT EXISTS "wordpress_role_mappings_wp_role_idx" ON "wordpress_role_mappings" USING btree ("wordpress_role_slug");
CREATE INDEX IF NOT EXISTS "wordpress_role_mappings_active_idx" ON "wordpress_role_mappings" USING btree ("is_active");
