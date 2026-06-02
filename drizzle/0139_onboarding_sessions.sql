CREATE TABLE IF NOT EXISTS "inventory"."onboarding_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"selected_plan" varchar(32),
	"status" varchar(32) DEFAULT 'org_created' NOT NULL,
	"current_step" varchar(64) DEFAULT 'import' NOT NULL,
	"import_session_id" uuid,
	"invites_draft" jsonb,
	"completed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory"."onboarding_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint ALTER TABLE "inventory"."onboarding_sessions" DROP CONSTRAINT IF EXISTS "onboarding_sessions_import_session_id_import_sessions_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."onboarding_sessions" ADD CONSTRAINT "onboarding_sessions_import_session_id_import_sessions_id_fk" FOREIGN KEY ("import_session_id") REFERENCES "inventory"."import_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_sessions_org_status_idx" ON "inventory"."onboarding_sessions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_sessions_active_org_uidx" ON "inventory"."onboarding_sessions" USING btree ("organization_id") WHERE deleted_at IS NULL AND completed_at IS NULL;--> statement-breakpoint DROP POLICY IF EXISTS "onboarding_sessions_org_isolation" ON "inventory"."onboarding_sessions";--> statement-breakpoint
CREATE POLICY "onboarding_sessions_org_isolation" ON "inventory"."onboarding_sessions" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
ALTER TABLE "inventory"."onboarding_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."onboarding_sessions" TO app_user;
