CREATE SCHEMA IF NOT EXISTS "agent";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent"."pending_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"kind" varchar(32) NOT NULL,
	"tool_name" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"resolved_at" timestamp,
	"resolution" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent"."pending_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"status" varchar(32) NOT NULL,
	"title" varchar(255),
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent"."sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent"."tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"tool_name" varchar(100) NOT NULL,
	"status" varchar(32) NOT NULL,
	"input" jsonb NOT NULL,
	"output_summary" text,
	"output_artifact_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "agent"."tool_calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent"."turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"status" varchar(32) NOT NULL,
	"user_input" jsonb NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"summary" text
);
--> statement-breakpoint
ALTER TABLE "agent"."turns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent"."uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"uploaded_by_user_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"source_filename" varchar(255) NOT NULL,
	"media_type" varchar(120) NOT NULL,
	"normalized_kind" varchar(50) NOT NULL,
	"manifest" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent"."uploads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent"."pending_requests" DROP CONSTRAINT IF EXISTS "pending_requests_session_id_sessions_id_fk";--> statement-breakpoint
ALTER TABLE "agent"."pending_requests" ADD CONSTRAINT "pending_requests_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "agent"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."pending_requests" DROP CONSTRAINT IF EXISTS "pending_requests_turn_id_turns_id_fk";--> statement-breakpoint
ALTER TABLE "agent"."pending_requests" ADD CONSTRAINT "pending_requests_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "agent"."turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."tool_calls" DROP CONSTRAINT IF EXISTS "tool_calls_session_id_sessions_id_fk";--> statement-breakpoint
ALTER TABLE "agent"."tool_calls" ADD CONSTRAINT "tool_calls_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "agent"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."tool_calls" DROP CONSTRAINT IF EXISTS "tool_calls_turn_id_turns_id_fk";--> statement-breakpoint
ALTER TABLE "agent"."tool_calls" ADD CONSTRAINT "tool_calls_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "agent"."turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."turns" DROP CONSTRAINT IF EXISTS "turns_session_id_sessions_id_fk";--> statement-breakpoint
ALTER TABLE "agent"."turns" ADD CONSTRAINT "turns_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "agent"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."uploads" DROP CONSTRAINT IF EXISTS "uploads_session_id_sessions_id_fk";--> statement-breakpoint
ALTER TABLE "agent"."uploads" ADD CONSTRAINT "uploads_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "agent"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_pending_requests_session_id_idx" ON "agent"."pending_requests" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_pending_requests_turn_id_idx" ON "agent"."pending_requests" USING btree ("turn_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_pending_requests_one_unresolved_per_session_uidx" ON "agent"."pending_requests" USING btree ("session_id") WHERE resolved_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sessions_org_id_idx" ON "agent"."sessions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sessions_user_id_idx" ON "agent"."sessions" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sessions_updated_at_idx" ON "agent"."sessions" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tool_calls_session_id_idx" ON "agent"."tool_calls" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tool_calls_turn_id_idx" ON "agent"."tool_calls" USING btree ("turn_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tool_calls_tool_name_idx" ON "agent"."tool_calls" USING btree ("tool_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_turns_session_id_idx" ON "agent"."turns" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_turns_org_id_idx" ON "agent"."turns" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_turns_started_at_idx" ON "agent"."turns" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_uploads_session_id_idx" ON "agent"."uploads" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_uploads_org_id_idx" ON "agent"."uploads" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_uploads_storage_key_uidx" ON "agent"."uploads" USING btree ("storage_key");--> statement-breakpoint
DROP POLICY IF EXISTS "agent_pending_requests_org_isolation" ON "agent"."pending_requests";--> statement-breakpoint
CREATE POLICY "agent_pending_requests_org_isolation" ON "agent"."pending_requests" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "agent_sessions_org_isolation" ON "agent"."sessions";--> statement-breakpoint
CREATE POLICY "agent_sessions_org_isolation" ON "agent"."sessions" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "agent_tool_calls_org_isolation" ON "agent"."tool_calls";--> statement-breakpoint
CREATE POLICY "agent_tool_calls_org_isolation" ON "agent"."tool_calls" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "agent_turns_org_isolation" ON "agent"."turns";--> statement-breakpoint
CREATE POLICY "agent_turns_org_isolation" ON "agent"."turns" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "agent_uploads_org_isolation" ON "agent"."uploads";--> statement-breakpoint
CREATE POLICY "agent_uploads_org_isolation" ON "agent"."uploads" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
ALTER TABLE "agent"."pending_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent"."sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent"."tool_calls" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent"."turns" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent"."uploads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT USAGE ON SCHEMA "agent" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "agent"."sessions" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "agent"."turns" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "agent"."pending_requests" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "agent"."uploads" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "agent"."tool_calls" TO app_user;
