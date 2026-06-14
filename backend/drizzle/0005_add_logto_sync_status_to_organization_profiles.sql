ALTER TABLE "organization_profiles" ALTER COLUMN "logto_organization_id" DROP NOT NULL;

ALTER TABLE "organization_profiles" ADD COLUMN IF NOT EXISTS "logto_sync_status" varchar(32) DEFAULT 'pending' NOT NULL;
ALTER TABLE "organization_profiles" ADD COLUMN IF NOT EXISTS "logto_sync_error" text;
ALTER TABLE "organization_profiles" ADD COLUMN IF NOT EXISTS "logto_synced_at" timestamp with time zone;

UPDATE "organization_profiles"
SET "logto_sync_status" = 'synced',
    "logto_synced_at" = COALESCE("logto_synced_at", "updated_at")
WHERE "logto_organization_id" IS NOT NULL
  AND "logto_sync_status" = 'synced';

CREATE INDEX IF NOT EXISTS "organization_profiles_logto_sync_status_idx" ON "organization_profiles" USING btree ("logto_sync_status");
