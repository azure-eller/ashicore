CREATE TABLE IF NOT EXISTS "inventory"."import_commit_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"record_type" varchar(64) NOT NULL,
	"action" varchar(32) NOT NULL,
	"local_record_id" uuid,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory"."import_commit_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory"."import_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" varchar(255) NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"extraction_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"extraction_error" text,
	"extracted_at" timestamp with time zone,
	"extracted_package" jsonb,
	"expires_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory"."import_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory"."import_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"status" varchar(32) DEFAULT 'uploaded' NOT NULL,
	"draft_package" jsonb,
	"normalized_package" jsonb,
	"approved_package" jsonb,
	"approved_package_hash" varchar(128),
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"committed_at" timestamp with time zone,
	"commit_summary" jsonb,
	"opening_stock_as_of" varchar(10),
	"include_boms" boolean DEFAULT true NOT NULL,
	"error" text,
	"processing_started_at" timestamp with time zone,
	"processing_lease_until" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"expires_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory"."import_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint ALTER TABLE "inventory"."import_commit_records" DROP CONSTRAINT IF EXISTS "import_commit_records_session_id_import_sessions_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."import_commit_records" ADD CONSTRAINT "import_commit_records_session_id_import_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "inventory"."import_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."import_files" DROP CONSTRAINT IF EXISTS "import_files_session_id_import_sessions_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."import_files" ADD CONSTRAINT "import_files_session_id_import_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "inventory"."import_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_commit_records_session_idx" ON "inventory"."import_commit_records" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_commit_records_org_type_idx" ON "inventory"."import_commit_records" USING btree ("organization_id","record_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_files_session_idx" ON "inventory"."import_files" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_files_org_status_idx" ON "inventory"."import_files" USING btree ("organization_id","extraction_status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_files_storage_key_uidx" ON "inventory"."import_files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_sessions_org_status_idx" ON "inventory"."import_sessions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_sessions_active_idx" ON "inventory"."import_sessions" USING btree ("organization_id") WHERE deleted_at IS NULL;--> statement-breakpoint DROP POLICY IF EXISTS "import_commit_records_org_isolation" ON "inventory"."import_commit_records";--> statement-breakpoint
CREATE POLICY "import_commit_records_org_isolation" ON "inventory"."import_commit_records" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint DROP POLICY IF EXISTS "import_files_org_isolation" ON "inventory"."import_files";--> statement-breakpoint
CREATE POLICY "import_files_org_isolation" ON "inventory"."import_files" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint DROP POLICY IF EXISTS "import_sessions_org_isolation" ON "inventory"."import_sessions";--> statement-breakpoint
CREATE POLICY "import_sessions_org_isolation" ON "inventory"."import_sessions" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
ALTER TABLE "inventory"."import_commit_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."import_files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."import_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."import_commit_records" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."import_files" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."import_sessions" TO app_user;
