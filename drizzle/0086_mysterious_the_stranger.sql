CREATE SCHEMA IF NOT EXISTS "addresses";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "addresses"."entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"label" varchar(120) NOT NULL,
	"contact_name" varchar(255),
	"contact_phone" varchar(50),
	"line1" varchar(255),
	"line2" varchar(255),
	"city" varchar(120),
	"region" varchar(120),
	"postcode" varchar(30),
	"country" varchar(120),
	"delivery_instructions" text,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "addresses"."entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "addresses"."entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT USAGE ON SCHEMA "addresses" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "addresses" TO app_user;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines" ADD COLUMN IF NOT EXISTS "ship_address_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines" ADD COLUMN IF NOT EXISTS "ship_contact_name" varchar(255);--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines" ADD COLUMN IF NOT EXISTS "ship_contact_phone" varchar(50);--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines" ADD COLUMN IF NOT EXISTS "ship_delivery_instructions" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "address_entries_org_id_idx" ON "addresses"."entries" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "address_entries_active_idx" ON "addresses"."entries" USING btree ("organization_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "address_entries_org_label_uidx" ON "addresses"."entries" USING btree ("organization_id","label") WHERE deleted_at IS NULL;--> statement-breakpoint ALTER TABLE "purchasing"."purchase_order_lines" DROP CONSTRAINT IF EXISTS "purchase_order_lines_ship_address_entry_id_entries_id_fk";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_ship_address_entry_id_entries_id_fk" FOREIGN KEY ("ship_address_entry_id") REFERENCES "addresses"."entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
DROP POLICY IF EXISTS "address_entries_org_isolation" ON "addresses"."entries";--> statement-breakpoint
CREATE POLICY "address_entries_org_isolation" ON "addresses"."entries" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));
