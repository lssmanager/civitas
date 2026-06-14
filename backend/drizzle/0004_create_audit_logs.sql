CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_user_id" uuid,
  "organization_id" varchar(255),
  "action" text NOT NULL,
  "result" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "audit_logs_actor_user_id_users_id_fk"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "audit_logs_actor_user_id_idx" ON "audit_logs" ("actor_user_id");
CREATE INDEX IF NOT EXISTS "audit_logs_organization_id_idx" ON "audit_logs" ("organization_id");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs" ("action");
CREATE INDEX IF NOT EXISTS "audit_logs_result_idx" ON "audit_logs" ("result");
