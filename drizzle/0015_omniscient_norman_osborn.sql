CREATE SCHEMA IF NOT EXISTS "purchasing";
--> statement-breakpoint
CREATE SEQUENCE "purchasing"."order_number_seq";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchasing"."purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"item_name" varchar(255) NOT NULL,
	"item_sku" varchar(50),
	"unit_name" varchar(50) NOT NULL,
	"quantity_ordered" numeric(12, 4) NOT NULL,
	"quantity_received" numeric(12, 4) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(10, 4) NOT NULL,
	"line_total" numeric(12, 4) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchasing"."purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"order_number" varchar(32) NOT NULL,
	"supplier_id" uuid NOT NULL,
	"supplier_name" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"expected_date" date,
	"notes" text,
	"total_amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	"ordered_at" timestamp,
	"received_at" timestamp,
	"cancelled_at" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchasing"."suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(50),
	"contact_name" varchar(255),
	"email" varchar(255),
	"phone" varchar(50),
	"address" text,
	"payment_terms" varchar(100),
	"notes" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint ALTER TABLE "purchasing"."purchase_order_lines" DROP CONSTRAINT IF EXISTS "purchase_order_lines_purchase_order_id_purchase_orders_id_fk";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "purchasing"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "purchasing"."purchase_order_lines" DROP CONSTRAINT IF EXISTS "purchase_order_lines_item_id_items_id_fk";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "inventory"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "purchasing"."purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_supplier_id_suppliers_id_fk";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "purchasing"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_order_lines_order_id_idx" ON "purchasing"."purchase_order_lines" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_order_lines_item_id_idx" ON "purchasing"."purchase_order_lines" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_order_lines_order_item_uidx" ON "purchasing"."purchase_order_lines" USING btree ("purchase_order_id","item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_orders_org_id_idx" ON "purchasing"."purchase_orders" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_orders_active_idx" ON "purchasing"."purchase_orders" USING btree ("organization_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_orders_status_idx" ON "purchasing"."purchase_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_orders_supplier_id_idx" ON "purchasing"."purchase_orders" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_orders_expected_date_idx" ON "purchasing"."purchase_orders" USING btree ("expected_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_orders_created_at_idx" ON "purchasing"."purchase_orders" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_orders_org_order_number_uidx" ON "purchasing"."purchase_orders" USING btree ("organization_id","order_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchasing_suppliers_org_id_idx" ON "purchasing"."suppliers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchasing_suppliers_active_idx" ON "purchasing"."suppliers" USING btree ("organization_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchasing_suppliers_name_idx" ON "purchasing"."suppliers" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchasing_suppliers_org_code_uidx" ON "purchasing"."suppliers" USING btree ("organization_id","code") WHERE code IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint DROP POLICY IF EXISTS "purchase_order_lines_org_isolation" ON "purchasing"."purchase_order_lines";--> statement-breakpoint
CREATE POLICY "purchase_order_lines_org_isolation" ON "purchasing"."purchase_order_lines" AS PERMISSIVE FOR ALL TO public USING (purchase_order_id IN (
          SELECT id
          FROM purchasing.purchase_orders
          WHERE organization_id = current_setting('app.current_org_id', true)
        )) WITH CHECK (purchase_order_id IN (
          SELECT id
          FROM purchasing.purchase_orders
          WHERE organization_id = current_setting('app.current_org_id', true)
        ));--> statement-breakpoint DROP POLICY IF EXISTS "purchase_orders_org_isolation" ON "purchasing"."purchase_orders";--> statement-breakpoint
CREATE POLICY "purchase_orders_org_isolation" ON "purchasing"."purchase_orders" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint DROP POLICY IF EXISTS "purchasing_suppliers_org_isolation" ON "purchasing"."suppliers";--> statement-breakpoint
CREATE POLICY "purchasing_suppliers_org_isolation" ON "purchasing"."suppliers" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
GRANT USAGE ON SCHEMA "purchasing" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "purchasing"."suppliers" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "purchasing"."purchase_orders" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "purchasing"."purchase_order_lines" TO app_user;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "purchasing"."order_number_seq" TO app_user;
