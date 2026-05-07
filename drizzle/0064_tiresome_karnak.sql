CREATE TABLE IF NOT EXISTS "xero"."xero_import_run_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"entity_type" varchar(20) NOT NULL,
	"action" varchar(20) NOT NULL,
	"local_record_id" uuid NOT NULL,
	"xero_contact_id" text,
	"local_name" text NOT NULL,
	"previous_data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "xero"."xero_import_run_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "xero"."xero_import_run_rows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "xero"."xero_import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"entity_type" varchar(20) NOT NULL,
	"tenant_id" text NOT NULL,
	"tenant_name" text NOT NULL,
	"status" varchar(20) DEFAULT 'completed' NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"undone_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "xero"."xero_import_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "xero"."xero_import_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "xero"."xero_import_runs" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "xero"."xero_import_run_rows" TO app_user;--> statement-breakpoint
ALTER TABLE "xero"."xero_import_run_rows" DROP CONSTRAINT IF EXISTS "xero_import_run_rows_run_id_xero_import_runs_id_fk";--> statement-breakpoint
ALTER TABLE "xero"."xero_import_run_rows" ADD CONSTRAINT "xero_import_run_rows_run_id_xero_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "xero"."xero_import_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "xero_import_run_rows_run_idx" ON "xero"."xero_import_run_rows" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "xero_import_run_rows_local_record_idx" ON "xero"."xero_import_run_rows" USING btree ("entity_type","local_record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "xero_import_runs_org_entity_idx" ON "xero"."xero_import_runs" USING btree ("organization_id","entity_type","created_at");--> statement-breakpoint
DROP POLICY IF EXISTS "xero_import_run_rows_org_isolation" ON "xero"."xero_import_run_rows";--> statement-breakpoint
CREATE POLICY "xero_import_run_rows_org_isolation" ON "xero"."xero_import_run_rows" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "xero_import_runs_org_isolation" ON "xero"."xero_import_runs";--> statement-breakpoint
CREATE POLICY "xero_import_runs_org_isolation" ON "xero"."xero_import_runs" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));
