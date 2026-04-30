CREATE TABLE IF NOT EXISTS "sales"."sales_shipment_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_shipment_id" uuid NOT NULL,
	"sales_order_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"item_name" varchar(255) NOT NULL,
	"item_sku" varchar(50),
	"unit_name" varchar(50) NOT NULL,
	"quantity" numeric(12, 4) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sales_shipment_lines_quantity_check" CHECK (quantity > 0)
);
--> statement-breakpoint
ALTER TABLE "sales"."sales_shipment_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."sales_shipment_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales"."sales_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"shipment_number" varchar(50) NOT NULL,
	"sequence" integer NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"fulfillment_type" varchar(20) DEFAULT 'delivery' NOT NULL,
	"scheduled_date" date,
	"shipped_at" timestamp,
	"notes" text,
	"order_number" varchar(32) NOT NULL,
	"customer_name" varchar(255) NOT NULL,
	"ship_line1" varchar(255),
	"ship_line2" varchar(255),
	"ship_city" varchar(120),
	"ship_region" varchar(120),
	"ship_postcode" varchar(30),
	"ship_country" varchar(120),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sales_shipments_status_check" CHECK (status IN ('draft', 'shipped', 'cancelled')),
	CONSTRAINT "sales_shipments_fulfillment_type_check" CHECK (fulfillment_type IN ('delivery', 'pickup')),
	CONSTRAINT "sales_shipments_shipped_at_check" CHECK ((status = 'shipped' AND shipped_at IS NOT NULL) OR (status <> 'shipped' AND shipped_at IS NULL))
);
--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD COLUMN IF NOT EXISTS "cancelled_quantity" numeric(12, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales"."sales_shipment_lines" DROP CONSTRAINT IF EXISTS "sales_shipment_lines_sales_shipment_id_sales_shipments_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."sales_shipment_lines" ADD CONSTRAINT "sales_shipment_lines_sales_shipment_id_sales_shipments_id_fk" FOREIGN KEY ("sales_shipment_id") REFERENCES "sales"."sales_shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."sales_shipment_lines" DROP CONSTRAINT IF EXISTS "sales_shipment_lines_sales_order_line_id_sales_order_lines_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."sales_shipment_lines" ADD CONSTRAINT "sales_shipment_lines_sales_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sales_order_line_id") REFERENCES "sales"."sales_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."sales_shipment_lines" DROP CONSTRAINT IF EXISTS "sales_shipment_lines_item_id_items_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."sales_shipment_lines" ADD CONSTRAINT "sales_shipment_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "inventory"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" DROP CONSTRAINT IF EXISTS "sales_shipments_sales_order_id_sales_orders_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" ADD CONSTRAINT "sales_shipments_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "sales"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_shipment_lines_shipment_id_idx" ON "sales"."sales_shipment_lines" USING btree ("sales_shipment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_shipment_lines_order_line_id_idx" ON "sales"."sales_shipment_lines" USING btree ("sales_order_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_shipment_lines_shipment_line_uidx" ON "sales"."sales_shipment_lines" USING btree ("sales_shipment_id","sales_order_line_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_shipments_org_id_idx" ON "sales"."sales_shipments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_shipments_order_id_idx" ON "sales"."sales_shipments" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_shipments_status_idx" ON "sales"."sales_shipments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_shipments_org_number_uidx" ON "sales"."sales_shipments" USING btree ("organization_id","shipment_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_shipments_order_sequence_uidx" ON "sales"."sales_shipments" USING btree ("sales_order_id","sequence");--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" DROP CONSTRAINT IF EXISTS "sales_order_lines_cancelled_quantity_check";--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD CONSTRAINT "sales_order_lines_cancelled_quantity_check" CHECK (cancelled_quantity >= 0 AND cancelled_quantity <= quantity);--> statement-breakpoint
DROP POLICY IF EXISTS "sales_shipment_lines_org_isolation" ON "sales"."sales_shipment_lines";--> statement-breakpoint
CREATE POLICY "sales_shipment_lines_org_isolation" ON "sales"."sales_shipment_lines" AS PERMISSIVE FOR ALL TO public USING (sales_shipment_id IN (
          SELECT id
          FROM sales.sales_shipments
          WHERE organization_id = current_setting('app.current_org_id', true)
        )) WITH CHECK (sales_shipment_id IN (
          SELECT id
          FROM sales.sales_shipments
          WHERE organization_id = current_setting('app.current_org_id', true)
        ));--> statement-breakpoint
DROP POLICY IF EXISTS "sales_shipments_org_isolation" ON "sales"."sales_shipments";--> statement-breakpoint
CREATE POLICY "sales_shipments_org_isolation" ON "sales"."sales_shipments" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
GRANT USAGE ON SCHEMA "sales" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sales"."sales_shipments" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sales"."sales_shipment_lines" TO app_user;
