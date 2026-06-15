-- Fase 07: organization_profiles.logto_sync_status now stores explicit Logto-first provisioning stages.
-- Existing varchar storage is intentionally kept; this migration documents and normalizes legacy pending rows.
UPDATE "organization_profiles"
SET "logto_sync_status" = 'logto_created'
WHERE "logto_organization_id" IS NOT NULL
  AND "logto_sync_status" = 'pending';
