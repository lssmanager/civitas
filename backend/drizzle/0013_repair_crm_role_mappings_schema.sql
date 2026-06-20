CREATE TABLE IF NOT EXISTS "crm_role_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "logto_role_id" varchar(255),
  "organization_role_name" varchar(255),
  "role_type" varchar(64) DEFAULT 'organizational' NOT NULL,
  "tags_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "lists_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "source" varchar(32) DEFAULT 'gui_override' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "logto_role_id" varchar(255);
ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "organization_role_name" varchar(255);
ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "role_name_cache" varchar(255);
ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "role_type" varchar(64) DEFAULT 'organizational' NOT NULL;
ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "tags_json" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "lists_json" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "fluentcrm_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "fluentcrm_lists" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true NOT NULL;
ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "source" varchar(32) DEFAULT 'gui_override' NOT NULL;
ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "crm_role_mappings" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

UPDATE "crm_role_mappings" SET "organization_role_name" = COALESCE("organization_role_name", "role_name_cache") WHERE "organization_role_name" IS NULL;
UPDATE "crm_role_mappings" SET "role_name_cache" = COALESCE("role_name_cache", "organization_role_name") WHERE "role_name_cache" IS NULL;
UPDATE "crm_role_mappings" SET "tags_json" = COALESCE("tags_json", "fluentcrm_tags", '[]'::jsonb);
UPDATE "crm_role_mappings" SET "lists_json" = COALESCE("lists_json", "fluentcrm_lists", '[]'::jsonb);
UPDATE "crm_role_mappings" SET "fluentcrm_tags" = COALESCE("fluentcrm_tags", "tags_json", '[]'::jsonb);
UPDATE "crm_role_mappings" SET "fluentcrm_lists" = COALESCE("fluentcrm_lists", "lists_json", '[]'::jsonb);
UPDATE "crm_role_mappings" SET "role_type" = 'organizational' WHERE "role_type" IS NULL;
UPDATE "crm_role_mappings" SET "is_active" = true WHERE "is_active" IS NULL;
UPDATE "crm_role_mappings" SET "source" = 'gui_override' WHERE "source" IS NULL;
UPDATE "crm_role_mappings" SET "created_at" = now() WHERE "created_at" IS NULL;
UPDATE "crm_role_mappings" SET "updated_at" = now() WHERE "updated_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "crm_role_mappings_logto_role_id_unique" ON "crm_role_mappings" USING btree ("logto_role_id") WHERE "logto_role_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "crm_role_mappings_role_name_idx" ON "crm_role_mappings" USING btree ("organization_role_name");
CREATE INDEX IF NOT EXISTS "crm_role_mappings_role_name_cache_idx" ON "crm_role_mappings" USING btree ("role_name_cache");
CREATE INDEX IF NOT EXISTS "crm_role_mappings_active_idx" ON "crm_role_mappings" USING btree ("is_active");
