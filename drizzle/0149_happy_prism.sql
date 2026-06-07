CREATE TABLE IF NOT EXISTS "sales"."customer_project_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" varchar(255),
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales"."customer_project_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint ALTER TABLE "sales"."customer_project_notes" DROP CONSTRAINT IF EXISTS "customer_project_notes_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."customer_project_notes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."customer_project_notes" ADD CONSTRAINT "customer_project_notes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "sales"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "sales"."customer_project_notes" DROP CONSTRAINT IF EXISTS "customer_project_notes_project_id_customer_projects_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."customer_project_notes" ADD CONSTRAINT "customer_project_notes_project_id_customer_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "sales"."customer_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_project_notes_org_id_idx" ON "sales"."customer_project_notes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_project_notes_project_id_idx" ON "sales"."customer_project_notes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_project_notes_active_idx" ON "sales"."customer_project_notes" USING btree ("organization_id","project_id") WHERE deleted_at IS NULL;--> statement-breakpoint DROP POLICY IF EXISTS "sales_customer_project_notes_org_isolation" ON "sales"."customer_project_notes";--> statement-breakpoint
CREATE POLICY "sales_customer_project_notes_org_isolation" ON "sales"."customer_project_notes" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));
