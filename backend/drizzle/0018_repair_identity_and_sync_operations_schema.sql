-- Repair production schema drift caused by older IF NOT EXISTS migrations.
-- This migration is intentionally additive and non-destructive: it creates missing
-- tables, adds missing columns, preserves legacy columns, and avoids DROP/rename.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "logto_user_id" varchar(255),
  "email" varchar(320),
  "status" varchar(32) DEFAULT 'active' NOT NULL,
  "last_login_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "logto_user_id" varchar(255);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email" varchar(320);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "status" varchar(32) DEFAULT 'active';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "global_role" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp with time zone;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
UPDATE "users" SET "id" = gen_random_uuid() WHERE "id" IS NULL;
UPDATE "users" SET "status" = 'active' WHERE "status" IS NULL;
UPDATE "users" SET "created_at" = now() WHERE "created_at" IS NULL;
UPDATE "users" SET "updated_at" = now() WHERE "updated_at" IS NULL;
ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'active';
ALTER TABLE "users" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "users" ALTER COLUMN "updated_at" SET DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS "users_logto_user_id_unique" ON "users" ("logto_user_id") WHERE "logto_user_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");
CREATE INDEX IF NOT EXISTS "users_global_role_idx" ON "users" ("global_role");

CREATE TABLE IF NOT EXISTS "sync_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "operation_type" varchar(128) DEFAULT 'organization_sync' NOT NULL,
  "entity_type" varchar(64) DEFAULT 'organization' NOT NULL,
  "entity_id" varchar(255),
  "logto_organization_id" varchar(255),
  "logto_user_id" varchar(255),
  "status" varchar(32) DEFAULT 'queued' NOT NULL,
  "canonical_status" varchar(32) DEFAULT 'pending' NOT NULL,
  "downstream_status" varchar(32) DEFAULT 'pending' NOT NULL,
  "correlation_id" varchar(255),
  "idempotency_key" varchar(255),
  "payload_snapshot_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "result_snapshot_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_error_json" jsonb,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "sync_operations" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE "sync_operations" ADD COLUMN IF NOT EXISTS "operation_type" varchar(128) DEFAULT 'organization_sync';
ALTER TABLE "sync_operations" ADD COLUMN IF NOT EXISTS "entity_type" varchar(64) DEFAULT 'organization';
ALTER TABLE "sync_operations" ADD COLUMN IF NOT EXISTS "entity_id" varchar(255);
ALTER TABLE "sync_operations" ADD COLUMN IF NOT EXISTS "logto_organization_id" varchar(255);
ALTER TABLE "sync_operations" ADD COLUMN IF NOT EXISTS "logto_user_id" varchar(255);
ALTER TABLE "sync_operations" ADD COLUMN IF NOT EXISTS "status" varchar(32) DEFAULT 'queued';
ALTER TABLE "sync_operations" ADD COLUMN IF NOT EXISTS "canonical_status" varchar(32) DEFAULT 'pending';
ALTER TABLE "sync_operations" ADD COLUMN IF NOT EXISTS "downstream_status" varchar(32) DEFAULT 'pending';
ALTER TABLE "sync_operations" ADD COLUMN IF NOT EXISTS "correlation_id" varchar(255);
ALTER TABLE "sync_operations" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(255);
ALTER TABLE "sync_operations" ADD COLUMN IF NOT EXISTS "payload_snapshot_json" jsonb DEFAULT '{}'::jsonb;
ALTER TABLE "sync_operations" ADD COLUMN IF NOT EXISTS "result_snapshot_json" jsonb DEFAULT '{}'::jsonb;
ALTER TABLE "sync_operations" ADD COLUMN IF NOT EXISTS "last_error_json" jsonb;
ALTER TABLE "sync_operations" ADD COLUMN IF NOT EXISTS "retry_count" integer DEFAULT 0;
ALTER TABLE "sync_operations" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;
ALTER TABLE "sync_operations" ADD COLUMN IF NOT EXISTS "finished_at" timestamp with time zone;
ALTER TABLE "sync_operations" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE "sync_operations" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
UPDATE "sync_operations" SET "id" = gen_random_uuid() WHERE "id" IS NULL;
UPDATE "sync_operations" SET "operation_type" = 'organization_sync' WHERE "operation_type" IS NULL;
UPDATE "sync_operations" SET "entity_type" = 'organization' WHERE "entity_type" IS NULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'sync_operations' AND column_name = 'organization_id') THEN
    EXECUTE 'UPDATE "sync_operations" SET "entity_id" = COALESCE("entity_id", "organization_id")';
    EXECUTE 'UPDATE "sync_operations" SET "logto_organization_id" = COALESCE("logto_organization_id", "organization_id")';
  END IF;
END $$;
UPDATE "sync_operations" SET "canonical_status" = COALESCE("canonical_status", CASE WHEN "status" IN ('completed','failed') THEN "status" ELSE 'pending' END);
UPDATE "sync_operations" SET "downstream_status" = COALESCE("downstream_status", CASE WHEN "status" IN ('completed','failed') THEN "status" ELSE 'pending' END);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'sync_operations' AND column_name = 'metadata') THEN
    EXECUTE 'UPDATE "sync_operations" SET "payload_snapshot_json" = COALESCE("payload_snapshot_json", "metadata", ''{}''::jsonb)';
  END IF;
END $$;
UPDATE "sync_operations" SET "result_snapshot_json" = COALESCE("result_snapshot_json", '{}'::jsonb);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'sync_operations' AND column_name = 'last_error') THEN
    EXECUTE 'UPDATE "sync_operations" SET "last_error_json" = jsonb_build_object(''message'', "last_error") WHERE "last_error_json" IS NULL AND "last_error" IS NOT NULL';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'sync_operations' AND column_name = 'attempts') THEN
    EXECUTE 'UPDATE "sync_operations" SET "retry_count" = COALESCE("retry_count", "attempts", 0)';
  END IF;
END $$;
UPDATE "sync_operations" SET "created_at" = now() WHERE "created_at" IS NULL;
UPDATE "sync_operations" SET "updated_at" = now() WHERE "updated_at" IS NULL;
ALTER TABLE "sync_operations" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "sync_operations" ALTER COLUMN "operation_type" SET DEFAULT 'organization_sync';
ALTER TABLE "sync_operations" ALTER COLUMN "entity_type" SET DEFAULT 'organization';
ALTER TABLE "sync_operations" ALTER COLUMN "status" SET DEFAULT 'queued';
ALTER TABLE "sync_operations" ALTER COLUMN "canonical_status" SET DEFAULT 'pending';
ALTER TABLE "sync_operations" ALTER COLUMN "downstream_status" SET DEFAULT 'pending';
ALTER TABLE "sync_operations" ALTER COLUMN "payload_snapshot_json" SET DEFAULT '{}'::jsonb;
ALTER TABLE "sync_operations" ALTER COLUMN "result_snapshot_json" SET DEFAULT '{}'::jsonb;
ALTER TABLE "sync_operations" ALTER COLUMN "retry_count" SET DEFAULT 0;
ALTER TABLE "sync_operations" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "sync_operations" ALTER COLUMN "updated_at" SET DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS "sync_operations_idempotency_unique" ON "sync_operations" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "sync_operations_operation_type_idx" ON "sync_operations" ("operation_type");
CREATE INDEX IF NOT EXISTS "sync_operations_entity_idx" ON "sync_operations" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "sync_operations_logto_org_idx" ON "sync_operations" ("logto_organization_id");
CREATE INDEX IF NOT EXISTS "sync_operations_status_idx" ON "sync_operations" ("status");
CREATE INDEX IF NOT EXISTS "sync_operations_correlation_idx" ON "sync_operations" ("correlation_id");
CREATE INDEX IF NOT EXISTS "sync_operations_created_at_idx" ON "sync_operations" ("created_at");

CREATE TABLE IF NOT EXISTS "sync_operation_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "operation_id" uuid,
  "step_name" varchar(128) DEFAULT 'unknown' NOT NULL,
  "queue_name" varchar(128) DEFAULT 'default' NOT NULL,
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
ALTER TABLE "sync_operation_steps" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE "sync_operation_steps" ADD COLUMN IF NOT EXISTS "operation_id" uuid;
ALTER TABLE "sync_operation_steps" ADD COLUMN IF NOT EXISTS "step_name" varchar(128) DEFAULT 'unknown';
ALTER TABLE "sync_operation_steps" ADD COLUMN IF NOT EXISTS "queue_name" varchar(128) DEFAULT 'default';
ALTER TABLE "sync_operation_steps" ADD COLUMN IF NOT EXISTS "job_id" varchar(255);
ALTER TABLE "sync_operation_steps" ADD COLUMN IF NOT EXISTS "attempt" integer DEFAULT 1;
ALTER TABLE "sync_operation_steps" ADD COLUMN IF NOT EXISTS "status" varchar(32) DEFAULT 'queued';
ALTER TABLE "sync_operation_steps" ADD COLUMN IF NOT EXISTS "output_json" jsonb;
ALTER TABLE "sync_operation_steps" ADD COLUMN IF NOT EXISTS "last_error_json" jsonb;
ALTER TABLE "sync_operation_steps" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;
ALTER TABLE "sync_operation_steps" ADD COLUMN IF NOT EXISTS "finished_at" timestamp with time zone;
ALTER TABLE "sync_operation_steps" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE "sync_operation_steps" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
UPDATE "sync_operation_steps" SET "id" = gen_random_uuid() WHERE "id" IS NULL;
UPDATE "sync_operation_steps" SET "step_name" = 'unknown' WHERE "step_name" IS NULL;
UPDATE "sync_operation_steps" SET "queue_name" = 'legacy-sync' WHERE "queue_name" IS NULL;
UPDATE "sync_operation_steps" SET "attempt" = 1 WHERE "attempt" IS NULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'sync_operation_steps' AND column_name = 'metadata') THEN
    EXECUTE 'UPDATE "sync_operation_steps" SET "output_json" = COALESCE("output_json", "metadata")';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'sync_operation_steps' AND column_name = 'error_message') THEN
    EXECUTE 'UPDATE "sync_operation_steps" SET "last_error_json" = jsonb_build_object(''message'', "error_message") WHERE "last_error_json" IS NULL AND "error_message" IS NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'sync_operation_steps' AND column_name = 'completed_at') THEN
    EXECUTE 'UPDATE "sync_operation_steps" SET "finished_at" = COALESCE("finished_at", "completed_at")';
  END IF;
END $$;
UPDATE "sync_operation_steps" SET "created_at" = now() WHERE "created_at" IS NULL;
UPDATE "sync_operation_steps" SET "updated_at" = now() WHERE "updated_at" IS NULL;
ALTER TABLE "sync_operation_steps" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "sync_operation_steps" ALTER COLUMN "step_name" SET DEFAULT 'unknown';
ALTER TABLE "sync_operation_steps" ALTER COLUMN "queue_name" SET DEFAULT 'default';
ALTER TABLE "sync_operation_steps" ALTER COLUMN "attempt" SET DEFAULT 1;
ALTER TABLE "sync_operation_steps" ALTER COLUMN "status" SET DEFAULT 'queued';
ALTER TABLE "sync_operation_steps" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "sync_operation_steps" ALTER COLUMN "updated_at" SET DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS "sync_operation_steps_attempt_unique" ON "sync_operation_steps" ("operation_id", "step_name", "attempt") WHERE "operation_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "sync_operation_steps_operation_idx" ON "sync_operation_steps" ("operation_id");
CREATE INDEX IF NOT EXISTS "sync_operation_steps_step_idx" ON "sync_operation_steps" ("step_name");
CREATE INDEX IF NOT EXISTS "sync_operation_steps_status_idx" ON "sync_operation_steps" ("status");
CREATE INDEX IF NOT EXISTS "sync_operation_steps_job_idx" ON "sync_operation_steps" ("queue_name", "job_id");
