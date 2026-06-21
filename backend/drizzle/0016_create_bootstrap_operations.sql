CREATE TABLE IF NOT EXISTS "organization_bootstrap_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_user_id" uuid,
  "logto_organization_id" varchar(255),
  "organization_profile_id" uuid,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "payload_snapshot" jsonb NOT NULL,
  "step_results" jsonb,
  "last_error" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "organization_bootstrap_operations_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE set null,
  CONSTRAINT "organization_bootstrap_operations_profile_id_profiles_id_fk" FOREIGN KEY ("organization_profile_id") REFERENCES "organization_profiles"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_bootstrap_operations_actor_user_idx" ON "organization_bootstrap_operations" USING btree ("actor_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_bootstrap_operations_logto_org_idx" ON "organization_bootstrap_operations" USING btree ("logto_organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_bootstrap_operations_status_idx" ON "organization_bootstrap_operations" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_bootstrap_operations_created_at_idx" ON "organization_bootstrap_operations" USING btree ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_bootstrap_micro_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "parent_operation_id" uuid NOT NULL,
  "logto_organization_id" varchar(255),
  "micro_request_type" varchar(128) NOT NULL,
  "target_entity_type" varchar(64) NOT NULL,
  "target_entity_id" varchar(255),
  "source_step" varchar(64),
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "payload_snapshot" jsonb,
  "last_error" jsonb,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "organization_bootstrap_micro_requests_parent_operation_id_fk" FOREIGN KEY ("parent_operation_id") REFERENCES "organization_bootstrap_operations"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_bootstrap_micro_requests_parent_idx" ON "organization_bootstrap_micro_requests" USING btree ("parent_operation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_bootstrap_micro_requests_logto_org_idx" ON "organization_bootstrap_micro_requests" USING btree ("logto_organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_bootstrap_micro_requests_status_idx" ON "organization_bootstrap_micro_requests" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_bootstrap_micro_requests_type_idx" ON "organization_bootstrap_micro_requests" USING btree ("micro_request_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_bootstrap_micro_requests_target_idx" ON "organization_bootstrap_micro_requests" USING btree ("target_entity_type", "target_entity_id");
