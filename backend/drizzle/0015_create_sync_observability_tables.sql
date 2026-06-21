CREATE TABLE IF NOT EXISTS "sync_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" varchar(255),
  "operation_type" varchar(64) DEFAULT 'organization_sync' NOT NULL,
  "status" varchar(32) DEFAULT 'queued' NOT NULL,
  "retryable" boolean DEFAULT false NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "metadata" jsonb,
  "next_retry_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "sync_operations_organization_idx" ON "sync_operations" ("organization_id");
CREATE INDEX IF NOT EXISTS "sync_operations_status_idx" ON "sync_operations" ("status");
CREATE INDEX IF NOT EXISTS "sync_operations_updated_at_idx" ON "sync_operations" ("updated_at");

CREATE TABLE IF NOT EXISTS "sync_operation_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "operation_id" uuid REFERENCES "sync_operations"("id") ON DELETE cascade,
  "organization_id" varchar(255),
  "step_name" varchar(128) NOT NULL,
  "status" varchar(32) DEFAULT 'queued' NOT NULL,
  "retryable" boolean DEFAULT false NOT NULL,
  "error_message" text,
  "metadata" jsonb,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "sync_operation_steps_operation_idx" ON "sync_operation_steps" ("operation_id");
CREATE INDEX IF NOT EXISTS "sync_operation_steps_organization_idx" ON "sync_operation_steps" ("organization_id");
CREATE INDEX IF NOT EXISTS "sync_operation_steps_status_idx" ON "sync_operation_steps" ("status");
