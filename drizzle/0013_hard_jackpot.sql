CREATE SCHEMA IF NOT EXISTS "sales";
--> statement-breakpoint
CREATE SEQUENCE "sales"."order_number_seq";
--> statement-breakpoint
CREATE TABLE "sales"."customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255),
	"phone" varchar(50),
	"address" text,
	"notes" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales"."customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."customers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales"."sales_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"item_name" varchar(255) NOT NULL,
	"item_sku" varchar(50),
	"unit_name" varchar(50) NOT NULL,
	"quantity" numeric(12, 4) NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"line_total" numeric(12, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales"."sales_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"order_number" varchar(32) NOT NULL,
	"customer_id" uuid NOT NULL,
	"customer_name" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"requested_date" date,
	"notes" text,
	"total_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD CONSTRAINT "sales_order_lines_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "sales"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD CONSTRAINT "sales_order_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "inventory"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ADD CONSTRAINT "sales_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "sales"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_customers_org_id_idx" ON "sales"."customers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sales_customers_active_idx" ON "sales"."customers" USING btree ("organization_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "sales_customers_name_idx" ON "sales"."customers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "sales_order_lines_order_id_idx" ON "sales"."sales_order_lines" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX "sales_order_lines_item_id_idx" ON "sales"."sales_order_lines" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_lines_order_item_uidx" ON "sales"."sales_order_lines" USING btree ("sales_order_id","item_id");--> statement-breakpoint
CREATE INDEX "sales_orders_org_id_idx" ON "sales"."sales_orders" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sales_orders_active_idx" ON "sales"."sales_orders" USING btree ("organization_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "sales_orders_status_idx" ON "sales"."sales_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sales_orders_created_at_idx" ON "sales"."sales_orders" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_orders_org_order_number_uidx" ON "sales"."sales_orders" USING btree ("organization_id","order_number");--> statement-breakpoint
CREATE POLICY "sales_customers_org_isolation" ON "sales"."customers" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "sales_order_lines_org_isolation" ON "sales"."sales_order_lines" AS PERMISSIVE FOR ALL TO public USING (sales_order_id IN (
          SELECT id
          FROM sales.sales_orders
          WHERE organization_id = current_setting('app.current_org_id', true)
        )) WITH CHECK (sales_order_id IN (
          SELECT id
          FROM sales.sales_orders
          WHERE organization_id = current_setting('app.current_org_id', true)
        ));--> statement-breakpoint
CREATE POLICY "sales_orders_org_isolation" ON "sales"."sales_orders" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
GRANT USAGE ON SCHEMA "sales" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sales"."customers" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sales"."sales_orders" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sales"."sales_order_lines" TO app_user;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "sales"."order_number_seq" TO app_user;
