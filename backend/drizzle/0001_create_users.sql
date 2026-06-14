CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "logto_user_id" varchar(255) NOT NULL,
  "email" varchar(320),
  "status" varchar(32) DEFAULT 'active' NOT NULL,
  "last_login_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "users_logto_user_id_unique" UNIQUE("logto_user_id")
);

CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");
