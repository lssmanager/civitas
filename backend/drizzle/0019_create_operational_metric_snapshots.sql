-- Operational telemetry only. These snapshots are not canonical business data;
-- they store aggregated Redis/BullMQ measurements for owner/system dashboards.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "operational_metric_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bucket" varchar(16) DEFAULT 'minute' NOT NULL,
  "bucket_started_at" timestamp with time zone NOT NULL,
  "source" varchar(64) DEFAULT 'redis_bullmq' NOT NULL,
  "metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "operational_metric_snapshots_bucket_time_idx" ON "operational_metric_snapshots" USING btree ("bucket", "bucket_started_at");
CREATE INDEX IF NOT EXISTS "operational_metric_snapshots_source_idx" ON "operational_metric_snapshots" USING btree ("source");
CREATE INDEX IF NOT EXISTS "operational_metric_snapshots_created_at_idx" ON "operational_metric_snapshots" USING btree ("created_at");
