ALTER TABLE "organization_profiles" ADD COLUMN IF NOT EXISTS "oidc_application_id" varchar(255);
ALTER TABLE "organization_profiles" ADD COLUMN IF NOT EXISTS "email_domain_provisioning_status" varchar(32) DEFAULT 'not_requested' NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "organization_profiles_admin_domain_unique" ON "organization_profiles" ("admin_domain") WHERE "admin_domain" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "organization_profiles_admin_domain_idx" ON "organization_profiles" ("admin_domain");
