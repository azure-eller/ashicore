CREATE SCHEMA IF NOT EXISTS "manufacturing";
--> statement-breakpoint
CREATE SEQUENCE "manufacturing"."order_number_seq";
--> statement-breakpoint
CREATE TABLE "manufacturing"."manufacturing_order_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manufacturing_order_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"item_name" varchar(255) NOT NULL,
	"item_sku" varchar(50),
	"item_type" varchar(20) NOT NULL,
	"unit_name" varchar(50) NOT NULL,
	"quantity_per_unit" numeric(12, 4) NOT NULL,
	"planned_quantity" numeric(12, 4) NOT NULL,
	"actual_quantity" numeric(12, 4),
	"actual_cost_total" numeric(12, 4),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "manufacturing"."manufacturing_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"order_number" varchar(32) NOT NULL,
	"product_id" uuid NOT NULL,
	"sales_order_id" uuid,
	"sales_order_line_id" uuid,
	"product_name" varchar(255) NOT NULL,
	"product_sku" varchar(50),
	"unit_name" varchar(50) NOT NULL,
	"sales_order_number" varchar(32),
	"sales_customer_name" varchar(255),
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"planned_quantity" numeric(12, 4) NOT NULL,
	"actual_quantity" numeric(12, 4),
	"planned_date" date,
	"actual_material_cost" numeric(12, 4),
	"actual_cost_per_unit" numeric(12, 4),
	"notes" text,
	"released_at" timestamp,
	"completed_at" timestamp,
	"cancelled_at" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" ADD COLUMN "movement_type" varchar(32) DEFAULT 'manual_adjustment' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" ADD COLUMN "reference_type" varchar(32);--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" ADD COLUMN "reference_id" uuid;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients" ADD CONSTRAINT "manufacturing_order_ingredients_manufacturing_order_id_manufacturing_orders_id_fk" FOREIGN KEY ("manufacturing_order_id") REFERENCES "manufacturing"."manufacturing_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients" ADD CONSTRAINT "manufacturing_order_ingredients_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "inventory"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_product_id_items_id_fk" FOREIGN KEY ("product_id") REFERENCES "inventory"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "sales"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manufacturing_order_ingredients_order_id_idx" ON "manufacturing"."manufacturing_order_ingredients" USING btree ("manufacturing_order_id");--> statement-breakpoint
CREATE INDEX "manufacturing_order_ingredients_item_id_idx" ON "manufacturing"."manufacturing_order_ingredients" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manufacturing_order_ingredients_order_item_uidx" ON "manufacturing"."manufacturing_order_ingredients" USING btree ("manufacturing_order_id","item_id");--> statement-breakpoint
CREATE INDEX "manufacturing_orders_org_id_idx" ON "manufacturing"."manufacturing_orders" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "manufacturing_orders_active_idx" ON "manufacturing"."manufacturing_orders" USING btree ("organization_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "manufacturing_orders_status_idx" ON "manufacturing"."manufacturing_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "manufacturing_orders_product_id_idx" ON "manufacturing"."manufacturing_orders" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "manufacturing_orders_sales_order_id_idx" ON "manufacturing"."manufacturing_orders" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX "manufacturing_orders_planned_date_idx" ON "manufacturing"."manufacturing_orders" USING btree ("planned_date");--> statement-breakpoint
CREATE INDEX "manufacturing_orders_created_at_idx" ON "manufacturing"."manufacturing_orders" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "manufacturing_orders_org_order_number_uidx" ON "manufacturing"."manufacturing_orders" USING btree ("organization_id","order_number");--> statement-breakpoint
CREATE POLICY "manufacturing_order_ingredients_org_isolation" ON "manufacturing"."manufacturing_order_ingredients" AS PERMISSIVE FOR ALL TO public USING (manufacturing_order_id IN (
          SELECT id
          FROM manufacturing.manufacturing_orders
          WHERE organization_id = current_setting('app.current_org_id', true)
        )) WITH CHECK (manufacturing_order_id IN (
          SELECT id
          FROM manufacturing.manufacturing_orders
          WHERE organization_id = current_setting('app.current_org_id', true)
        ));--> statement-breakpoint
CREATE POLICY "manufacturing_orders_org_isolation" ON "manufacturing"."manufacturing_orders" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
GRANT USAGE ON SCHEMA "manufacturing" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manufacturing"."manufacturing_orders" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manufacturing"."manufacturing_order_ingredients" TO app_user;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "manufacturing"."order_number_seq" TO app_user;
