CREATE TABLE IF NOT EXISTS "sales"."customer_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"title" varchar(255),
	"email" varchar(255),
	"phone" varchar(50),
	"is_primary" boolean DEFAULT false NOT NULL,
	"receives_shipping" boolean DEFAULT false NOT NULL,
	"receives_invoices" boolean DEFAULT false NOT NULL,
	"receives_billing_cc" boolean DEFAULT false NOT NULL,
	"is_on_site" boolean DEFAULT false NOT NULL,
	"notes" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales"."customer_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."customer_contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales"."customer_correspondence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"title" varchar(255),
	"body" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_name" varchar(255),
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sales_customer_correspondence_type_check" CHECK ("type" IN ('note', 'call', 'email', 'meeting'))
);
--> statement-breakpoint
ALTER TABLE "sales"."customer_correspondence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."customer_correspondence" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales"."customer_correspondence_attendees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"correspondence_id" uuid NOT NULL,
	"contact_id" uuid,
	"contact_name" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales"."customer_correspondence_attendees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."customer_correspondence_attendees" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales"."customer_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'planning' NOT NULL,
	"start_date" date,
	"target_end_date" date,
	"summary" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sales_customer_projects_status_check" CHECK ("status" IN ('planning', 'active', 'hold', 'done'))
);
--> statement-breakpoint
ALTER TABLE "sales"."customer_projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."customer_projects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales"."customer_project_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"blob_url" text NOT NULL,
	"filename" varchar(255) NOT NULL,
	"content_type" varchar(120) NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by_user_id" text NOT NULL,
	"uploaded_by_name" varchar(255),
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales"."customer_project_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."customer_project_files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT USAGE ON SCHEMA "sales" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sales"."customer_contacts" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sales"."customer_correspondence" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sales"."customer_correspondence_attendees" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sales"."customer_projects" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sales"."customer_project_files" TO app_user;--> statement-breakpoint
ALTER TABLE "sales"."customer_contacts" DROP CONSTRAINT IF EXISTS "customer_contacts_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."customer_contacts" ADD CONSTRAINT "customer_contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "sales"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."customer_correspondence" DROP CONSTRAINT IF EXISTS "customer_correspondence_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."customer_correspondence" ADD CONSTRAINT "customer_correspondence_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "sales"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."customer_correspondence_attendees" DROP CONSTRAINT IF EXISTS "customer_correspondence_attendees_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."customer_correspondence_attendees" ADD CONSTRAINT "customer_correspondence_attendees_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "sales"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."customer_correspondence_attendees" DROP CONSTRAINT IF EXISTS "customer_correspondence_attendees_correspondence_id_customer_correspondence_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."customer_correspondence_attendees" ADD CONSTRAINT "customer_correspondence_attendees_correspondence_id_customer_correspondence_id_fk" FOREIGN KEY ("correspondence_id") REFERENCES "sales"."customer_correspondence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."customer_correspondence_attendees" DROP CONSTRAINT IF EXISTS "customer_correspondence_attendees_contact_id_customer_contacts_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."customer_correspondence_attendees" ADD CONSTRAINT "customer_correspondence_attendees_contact_id_customer_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "sales"."customer_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."customer_projects" DROP CONSTRAINT IF EXISTS "customer_projects_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."customer_projects" ADD CONSTRAINT "customer_projects_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "sales"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."customer_project_files" DROP CONSTRAINT IF EXISTS "customer_project_files_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."customer_project_files" ADD CONSTRAINT "customer_project_files_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "sales"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."customer_project_files" DROP CONSTRAINT IF EXISTS "customer_project_files_project_id_customer_projects_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."customer_project_files" ADD CONSTRAINT "customer_project_files_project_id_customer_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "sales"."customer_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_contacts_org_id_idx" ON "sales"."customer_contacts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_contacts_customer_id_idx" ON "sales"."customer_contacts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_contacts_active_idx" ON "sales"."customer_contacts" USING btree ("organization_id","customer_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_correspondence_org_id_idx" ON "sales"."customer_correspondence" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_correspondence_customer_id_idx" ON "sales"."customer_correspondence" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_correspondence_occurred_at_idx" ON "sales"."customer_correspondence" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_correspondence_attendees_org_id_idx" ON "sales"."customer_correspondence_attendees" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_correspondence_attendees_correspondence_id_idx" ON "sales"."customer_correspondence_attendees" USING btree ("correspondence_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_correspondence_attendees_contact_id_idx" ON "sales"."customer_correspondence_attendees" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_projects_org_id_idx" ON "sales"."customer_projects" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_projects_customer_id_idx" ON "sales"."customer_projects" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_projects_active_idx" ON "sales"."customer_projects" USING btree ("organization_id","customer_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_project_files_org_id_idx" ON "sales"."customer_project_files" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_project_files_project_id_idx" ON "sales"."customer_project_files" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_project_files_active_idx" ON "sales"."customer_project_files" USING btree ("organization_id","project_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_customer_project_files_storage_key_uidx" ON "sales"."customer_project_files" USING btree ("storage_key");--> statement-breakpoint
DROP POLICY IF EXISTS "sales_customer_contacts_org_isolation" ON "sales"."customer_contacts";--> statement-breakpoint
CREATE POLICY "sales_customer_contacts_org_isolation" ON "sales"."customer_contacts" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "sales_customer_correspondence_org_isolation" ON "sales"."customer_correspondence";--> statement-breakpoint
CREATE POLICY "sales_customer_correspondence_org_isolation" ON "sales"."customer_correspondence" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "sales_customer_correspondence_attendees_org_isolation" ON "sales"."customer_correspondence_attendees";--> statement-breakpoint
CREATE POLICY "sales_customer_correspondence_attendees_org_isolation" ON "sales"."customer_correspondence_attendees" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "sales_customer_projects_org_isolation" ON "sales"."customer_projects";--> statement-breakpoint
CREATE POLICY "sales_customer_projects_org_isolation" ON "sales"."customer_projects" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "sales_customer_project_files_org_isolation" ON "sales"."customer_project_files";--> statement-breakpoint
CREATE POLICY "sales_customer_project_files_org_isolation" ON "sales"."customer_project_files" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));
