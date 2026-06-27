CREATE TABLE IF NOT EXISTS "manual_sync_resolutions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "operation_id" uuid NOT NULL REFERENCES "sync_operations"("id") ON DELETE cascade,
  "step_id" uuid REFERENCES "sync_operation_steps"("id") ON DELETE set null,
  "organization_id" varchar(255),
  "resolution_type" varchar(64) NOT NULL,
  "resolution_reason" text,
  "resolved_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
  "notes" text,
  "applies_until" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS "manual_sync_resolutions_operation_idx" ON "manual_sync_resolutions" ("operation_id");
CREATE INDEX IF NOT EXISTS "manual_sync_resolutions_step_idx" ON "manual_sync_resolutions" ("step_id");
CREATE INDEX IF NOT EXISTS "manual_sync_resolutions_org_idx" ON "manual_sync_resolutions" ("organization_id");
CREATE INDEX IF NOT EXISTS "manual_sync_resolutions_resolved_at_idx" ON "manual_sync_resolutions" ("resolved_at");
