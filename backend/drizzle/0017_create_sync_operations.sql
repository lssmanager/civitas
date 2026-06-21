CREATE TABLE IF NOT EXISTS "sync_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "operation_type" varchar(128) NOT NULL,
  "entity_type" varchar(64) NOT NULL,
  "entity_id" varchar(255),
  "logto_organization_id" varchar(255),
  "logto_user_id" varchar(255),
  "status" varchar(32) DEFAULT 'queued' NOT NULL,
  "canonical_status" varchar(32) DEFAULT 'pending' NOT NULL,
  "downstream_status" varchar(32) DEFAULT 'pending' NOT NULL,
  "correlation_id" varchar(255) NOT NULL,
  "idempotency_key" varchar(255) NOT NULL,
  "payload_snapshot_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "result_snapshot_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_error_json" jsonb,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "sync_operations_idempotency_unique" ON "sync_operations" USING btree ("idempotency_key");
CREATE INDEX IF NOT EXISTS "sync_operations_operation_type_idx" ON "sync_operations" USING btree ("operation_type");
CREATE INDEX IF NOT EXISTS "sync_operations_entity_idx" ON "sync_operations" USING btree ("entity_type","entity_id");
CREATE INDEX IF NOT EXISTS "sync_operations_logto_org_idx" ON "sync_operations" USING btree ("logto_organization_id");
CREATE INDEX IF NOT EXISTS "sync_operations_status_idx" ON "sync_operations" USING btree ("status");
CREATE INDEX IF NOT EXISTS "sync_operations_correlation_idx" ON "sync_operations" USING btree ("correlation_id");

CREATE TABLE IF NOT EXISTS "sync_operation_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "operation_id" uuid NOT NULL REFERENCES "sync_operations"("id") ON DELETE cascade,
  "step_name" varchar(128) NOT NULL,
  "queue_name" varchar(128) NOT NULL,
  "job_id" varchar(255),
  "attempt" integer DEFAULT 1 NOT NULL,
  "status" varchar(32) DEFAULT 'queued' NOT NULL,
  "output_json" jsonb,
  "last_error_json" jsonb,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "sync_operation_steps_attempt_unique" ON "sync_operation_steps" USING btree ("operation_id","step_name","attempt");
CREATE INDEX IF NOT EXISTS "sync_operation_steps_operation_idx" ON "sync_operation_steps" USING btree ("operation_id");
CREATE INDEX IF NOT EXISTS "sync_operation_steps_step_idx" ON "sync_operation_steps" USING btree ("step_name");
CREATE INDEX IF NOT EXISTS "sync_operation_steps_status_idx" ON "sync_operation_steps" USING btree ("status");
CREATE INDEX IF NOT EXISTS "sync_operation_steps_job_idx" ON "sync_operation_steps" USING btree ("queue_name","job_id");
