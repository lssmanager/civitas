ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "global_role" text;

CREATE INDEX IF NOT EXISTS "users_global_role_idx" ON "users" ("global_role");
