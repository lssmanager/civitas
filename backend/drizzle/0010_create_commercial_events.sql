CREATE TABLE IF NOT EXISTS "commercial_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" varchar(255) NOT NULL,
  "idempotency_key" varchar(255) NOT NULL,
  "payload_hash" varchar(64) NOT NULL,
  "source" varchar(64) DEFAULT 'wordpress_fluentcrm' NOT NULL,
  "event_type" varchar(64) NOT NULL,
  "status" varchar(32) DEFAULT 'received' NOT NULL,
  "organization_profile_id" uuid,
  "logto_organization_id" varchar(255),
  "seat_delta" integer,
  "commercial_status_after" varchar(32),
  "logto_change_summary" jsonb,
  "sanitized_payload" jsonb,
  "error_summary" text,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "occurred_at" timestamp with time zone,
  "applied_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "commercial_events_organization_profile_id_organization_profiles_id_fk" FOREIGN KEY ("organization_profile_id") REFERENCES "organization_profiles"("id") ON DELETE set null
);

CREATE UNIQUE INDEX IF NOT EXISTS "commercial_events_event_id_unique" ON "commercial_events" ("event_id");
CREATE INDEX IF NOT EXISTS "commercial_events_idempotency_idx" ON "commercial_events" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "commercial_events_status_idx" ON "commercial_events" ("status");
CREATE INDEX IF NOT EXISTS "commercial_events_logto_org_idx" ON "commercial_events" ("logto_organization_id");
