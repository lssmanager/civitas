CREATE TABLE IF NOT EXISTS "crm_role_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "logto_role_id" varchar(255) NOT NULL,
  "organization_role_name" varchar(255) NOT NULL,
  "tags_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "lists_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "role_type" varchar(64) DEFAULT 'organizational' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "source" varchar(32) DEFAULT 'gui_override' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "crm_role_mappings_logto_role_id_unique" UNIQUE("logto_role_id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_role_mappings_logto_role_id_unique" ON "crm_role_mappings" USING btree ("logto_role_id");
CREATE INDEX IF NOT EXISTS "crm_role_mappings_role_name_idx" ON "crm_role_mappings" USING btree ("organization_role_name");
CREATE INDEX IF NOT EXISTS "crm_role_mappings_active_idx" ON "crm_role_mappings" USING btree ("is_active");
