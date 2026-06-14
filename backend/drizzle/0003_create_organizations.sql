CREATE TABLE IF NOT EXISTS "organizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "type" varchar(32) NOT NULL,
  "status" varchar(32) DEFAULT 'active' NOT NULL,
  "subdomain" varchar(63) NOT NULL,
  "seat_total" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "organizations_name_length" CHECK (char_length("name") BETWEEN 2 AND 120),
  CONSTRAINT "organizations_type_allowed" CHECK ("type" IN ('school', 'district', 'community', 'other')),
  CONSTRAINT "organizations_status_allowed" CHECK ("status" IN ('active', 'inactive', 'archived')),
  CONSTRAINT "organizations_subdomain_format" CHECK ("subdomain" ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
  CONSTRAINT "organizations_seat_total_non_negative" CHECK ("seat_total" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "organizations_name_unique" ON "organizations" ("name");
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_subdomain_unique" ON "organizations" ("subdomain");
CREATE INDEX IF NOT EXISTS "organizations_status_idx" ON "organizations" ("status");
CREATE INDEX IF NOT EXISTS "organizations_type_idx" ON "organizations" ("type");
