ALTER TABLE "organization_profiles" ADD COLUMN IF NOT EXISTS "fluentcrm_company_id" varchar(255);
ALTER TABLE "organization_profiles" ADD COLUMN IF NOT EXISTS "fluentcrm_sync_status" varchar(32) DEFAULT 'not_linked' NOT NULL;
ALTER TABLE "organization_profiles" ADD COLUMN IF NOT EXISTS "fluentcrm_sync_error" text;
ALTER TABLE "organization_profiles" ADD COLUMN IF NOT EXISTS "fluentcrm_synced_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "organization_profiles_fluentcrm_company_idx" ON "organization_profiles" USING btree ("fluentcrm_company_id");
CREATE INDEX IF NOT EXISTS "organization_profiles_fluentcrm_sync_status_idx" ON "organization_profiles" USING btree ("fluentcrm_sync_status");
