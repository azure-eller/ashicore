CREATE SCHEMA IF NOT EXISTS "reporting";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reporting"."report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"report_type" varchar(64) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"local_send_time" time DEFAULT '17:00:00' NOT NULL,
	"time_zone" text DEFAULT 'America/Denver' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_schedules_report_type_check" CHECK ("report_type" IN ('daily_manufacturing'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reporting"."report_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"schedule_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reporting"."report_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"report_type" varchar(64) NOT NULL,
	"report_date" date NOT NULL,
	"time_zone" text NOT NULL,
	"window_start_at" timestamp with time zone NOT NULL,
	"window_end_at" timestamp with time zone NOT NULL,
	"payload_version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(24) DEFAULT 'generating' NOT NULL,
	"email_sent_at" timestamp with time zone,
	"failure_message" text,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_runs_report_type_check" CHECK ("report_type" IN ('daily_manufacturing')),
	CONSTRAINT "report_runs_status_check" CHECK ("status" IN ('generating', 'generated', 'sent', 'failed')),
	CONSTRAINT "report_runs_payload_version_check" CHECK ("payload_version" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reporting"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" varchar(64) NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"entity_type" varchar(64) NOT NULL,
	"entity_id" text NOT NULL,
	"delivery_status" varchar(32) DEFAULT 'created' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_type_check" CHECK ("type" IN ('daily_manufacturing_report')),
	CONSTRAINT "notifications_entity_type_check" CHECK ("entity_type" IN ('report_run')),
	CONSTRAINT "notifications_delivery_status_check" CHECK ("delivery_status" IN ('created', 'delivered', 'failed'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reporting"."report_schedules" ADD CONSTRAINT "report_schedules_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "system"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reporting"."report_recipients" ADD CONSTRAINT "report_recipients_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "system"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reporting"."report_recipients" ADD CONSTRAINT "report_recipients_schedule_id_report_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "reporting"."report_schedules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reporting"."report_recipients" ADD CONSTRAINT "report_recipients_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "system"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reporting"."report_runs" ADD CONSTRAINT "report_runs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "system"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reporting"."notifications" ADD CONSTRAINT "notifications_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "system"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reporting"."notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "system"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "report_schedules_org_type_uidx" ON "reporting"."report_schedules" USING btree ("organization_id","report_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_schedules_enabled_idx" ON "reporting"."report_schedules" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "report_recipients_schedule_user_uidx" ON "reporting"."report_recipients" USING btree ("schedule_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_recipients_org_idx" ON "reporting"."report_recipients" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "report_runs_org_type_date_uidx" ON "reporting"."report_runs" USING btree ("organization_id","report_type","report_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_runs_org_type_created_idx" ON "reporting"."report_runs" USING btree ("organization_id","report_type","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_created_idx" ON "reporting"."notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_org_user_read_idx" ON "reporting"."notifications" USING btree ("organization_id","user_id","read_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_entity_idx" ON "reporting"."notifications" USING btree ("entity_type","entity_id");--> statement-breakpoint
ALTER TABLE "reporting"."report_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reporting"."report_schedules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reporting"."report_recipients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reporting"."report_recipients" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reporting"."report_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reporting"."report_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reporting"."notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reporting"."notifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "report_schedules_org_isolation" ON "reporting"."report_schedules";--> statement-breakpoint
CREATE POLICY "report_schedules_org_isolation" ON "reporting"."report_schedules" AS PERMISSIVE FOR ALL TO public USING ("organization_id" = current_setting('app.current_org_id', true)) WITH CHECK ("organization_id" = current_setting('app.current_org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "report_recipients_org_isolation" ON "reporting"."report_recipients";--> statement-breakpoint
CREATE POLICY "report_recipients_org_isolation" ON "reporting"."report_recipients" AS PERMISSIVE FOR ALL TO public USING ("organization_id" = current_setting('app.current_org_id', true)) WITH CHECK ("organization_id" = current_setting('app.current_org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "report_runs_org_isolation" ON "reporting"."report_runs";--> statement-breakpoint
CREATE POLICY "report_runs_org_isolation" ON "reporting"."report_runs" AS PERMISSIVE FOR ALL TO public USING ("organization_id" = current_setting('app.current_org_id', true)) WITH CHECK ("organization_id" = current_setting('app.current_org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "notifications_org_isolation" ON "reporting"."notifications";--> statement-breakpoint
CREATE POLICY "notifications_org_isolation" ON "reporting"."notifications" AS PERMISSIVE FOR ALL TO public USING ("organization_id" = current_setting('app.current_org_id', true)) WITH CHECK ("organization_id" = current_setting('app.current_org_id', true));--> statement-breakpoint
GRANT USAGE ON SCHEMA "reporting" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "reporting"."report_schedules" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "reporting"."report_recipients" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "reporting"."report_runs" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "reporting"."notifications" TO app_user;
