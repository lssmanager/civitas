CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS "health_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "service" varchar(64) DEFAULT 'civitas-api' NOT NULL,
  "checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
