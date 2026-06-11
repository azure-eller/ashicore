CREATE TABLE IF NOT EXISTS "sales"."customer_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"customer_project_id" uuid,
	"type" varchar(20) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" varchar(255),
	"body" text,
	"due_date" date,
	"status" varchar(10),
	"completed_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_by_name" varchar(255),
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_customer_activities_type_check" CHECK ("sales"."customer_activities"."type" IN ('note', 'call', 'email', 'meeting', 'task')),
	CONSTRAINT "sales_customer_activities_task_fields_check" CHECK (("sales"."customer_activities"."type" = 'task' AND "sales"."customer_activities"."status" IN ('open', 'done') AND "sales"."customer_activities"."title" IS NOT NULL) OR ("sales"."customer_activities"."type" <> 'task' AND "sales"."customer_activities"."status" IS NULL AND "sales"."customer_activities"."due_date" IS NULL AND "sales"."customer_activities"."completed_at" IS NULL AND "sales"."customer_activities"."body" IS NOT NULL)),
	CONSTRAINT "sales_customer_activities_completed_at_check" CHECK ("sales"."customer_activities"."type" <> 'task' OR (("sales"."customer_activities"."status" = 'done') = ("sales"."customer_activities"."completed_at" IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE "sales"."customer_activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales"."customer_activity_attendees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"contact_id" uuid,
	"contact_name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales"."customer_activity_attendees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint ALTER TABLE "sales"."customer_activities" DROP CONSTRAINT IF EXISTS "customer_activities_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."customer_activities" ADD CONSTRAINT "customer_activities_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "sales"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "sales"."customer_activities" DROP CONSTRAINT IF EXISTS "customer_activities_customer_project_id_customer_projects_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."customer_activities" ADD CONSTRAINT "customer_activities_customer_project_id_customer_projects_id_fk" FOREIGN KEY ("customer_project_id") REFERENCES "sales"."customer_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "sales"."customer_activity_attendees" DROP CONSTRAINT IF EXISTS "customer_activity_attendees_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."customer_activity_attendees" ADD CONSTRAINT "customer_activity_attendees_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "sales"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "sales"."customer_activity_attendees" DROP CONSTRAINT IF EXISTS "customer_activity_attendees_activity_id_customer_activities_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."customer_activity_attendees" ADD CONSTRAINT "customer_activity_attendees_activity_id_customer_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "sales"."customer_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint ALTER TABLE "sales"."customer_activity_attendees" DROP CONSTRAINT IF EXISTS "customer_activity_attendees_contact_id_customer_contacts_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."customer_activity_attendees" ADD CONSTRAINT "customer_activity_attendees_contact_id_customer_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "sales"."customer_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_activities_org_id_idx" ON "sales"."customer_activities" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_activities_customer_id_idx" ON "sales"."customer_activities" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_activities_occurred_at_idx" ON "sales"."customer_activities" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_activity_attendees_org_id_idx" ON "sales"."customer_activity_attendees" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_activity_attendees_activity_id_idx" ON "sales"."customer_activity_attendees" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_activity_attendees_contact_id_idx" ON "sales"."customer_activity_attendees" USING btree ("contact_id");--> statement-breakpoint DROP POLICY IF EXISTS "sales_customer_activities_org_isolation" ON "sales"."customer_activities";--> statement-breakpoint
CREATE POLICY "sales_customer_activities_org_isolation" ON "sales"."customer_activities" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint DROP POLICY IF EXISTS "sales_customer_activity_attendees_org_isolation" ON "sales"."customer_activity_attendees";--> statement-breakpoint
CREATE POLICY "sales_customer_activity_attendees_org_isolation" ON "sales"."customer_activity_attendees" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
ALTER TABLE "sales"."customer_activities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."customer_activity_attendees" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sales"."customer_activities" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sales"."customer_activity_attendees" TO app_user;--> statement-breakpoint
GRANT SELECT ON TABLE "sales"."customer_activities" TO erp_agent_ro;--> statement-breakpoint
GRANT SELECT ON TABLE "sales"."customer_activity_attendees" TO erp_agent_ro;--> statement-breakpoint
DROP POLICY IF EXISTS agent_org_isolation ON "sales"."customer_activities";--> statement-breakpoint
CREATE POLICY agent_org_isolation ON "sales"."customer_activities" AS RESTRICTIVE TO erp_agent_ro USING (organization_id = agent_query.current_org());--> statement-breakpoint
DROP POLICY IF EXISTS agent_org_isolation ON "sales"."customer_activity_attendees";--> statement-breakpoint
CREATE POLICY agent_org_isolation ON "sales"."customer_activity_attendees" AS RESTRICTIVE TO erp_agent_ro USING (organization_id = agent_query.current_org());
