-- Owner manual resolutions are Civitas operational decisions, not provider truth.
-- They persist who reviewed a sync conflict, why, and how long that decision applies.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "sync_manual_resolutions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "operation_id" uuid NOT NULL REFERENCES "sync_operations"("id") ON DELETE CASCADE,
  "step_id" uuid REFERENCES "sync_operation_steps"("id") ON DELETE SET NULL,
  "organization_id" varchar(255) NOT NULL,
  "resolution_type" varchar(64) NOT NULL,
  "resolution_reason" text NOT NULL,
  "resolved_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
  "notes" text,
  "applies_until" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "sync_manual_resolutions_operation_idx" ON "sync_manual_resolutions" USING btree ("operation_id");
CREATE INDEX IF NOT EXISTS "sync_manual_resolutions_step_idx" ON "sync_manual_resolutions" USING btree ("step_id");
CREATE INDEX IF NOT EXISTS "sync_manual_resolutions_organization_idx" ON "sync_manual_resolutions" USING btree ("organization_id");
CREATE INDEX IF NOT EXISTS "sync_manual_resolutions_type_idx" ON "sync_manual_resolutions" USING btree ("resolution_type");
