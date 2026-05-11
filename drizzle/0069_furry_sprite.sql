CREATE TABLE IF NOT EXISTS "sales"."sales_order_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"sales_order_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"source_type" varchar(30) NOT NULL,
	"source_id" uuid,
	"quantity" numeric(12, 4) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_by" text,
	"updated_by" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_order_allocations_source_type_check" CHECK (source_type IN ('stock_pool', 'manufacturing_order')),
	CONSTRAINT "sales_order_allocations_status_check" CHECK (status IN ('active', 'consumed', 'cancelled')),
	CONSTRAINT "sales_order_allocations_quantity_check" CHECK (quantity > 0),
	CONSTRAINT "sales_order_allocations_source_id_check" CHECK ((source_type = 'stock_pool' AND source_id IS NULL) OR (source_type = 'manufacturing_order' AND source_id IS NOT NULL)),
	CONSTRAINT "sales_order_allocations_cancelled_check" CHECK ((status = 'cancelled' AND cancelled_at IS NOT NULL) OR (status <> 'cancelled' AND cancelled_at IS NULL))
);
--> statement-breakpoint
ALTER TABLE "sales"."sales_order_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD COLUMN IF NOT EXISTS "allocation_managed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD COLUMN IF NOT EXISTS "allocation_managed_by" text;--> statement-breakpoint ALTER TABLE "sales"."sales_order_allocations" DROP CONSTRAINT IF EXISTS "sales_order_allocations_sales_order_line_id_sales_order_lines_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."sales_order_allocations" ADD CONSTRAINT "sales_order_allocations_sales_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sales_order_line_id") REFERENCES "sales"."sales_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "sales"."sales_order_allocations" DROP CONSTRAINT IF EXISTS "sales_order_allocations_item_id_items_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."sales_order_allocations" ADD CONSTRAINT "sales_order_allocations_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "inventory"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_order_allocations_org_id_idx" ON "sales"."sales_order_allocations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_order_allocations_line_id_idx" ON "sales"."sales_order_allocations" USING btree ("sales_order_line_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_order_allocations_item_source_idx" ON "sales"."sales_order_allocations" USING btree ("organization_id","item_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_order_allocations_active_item_idx" ON "sales"."sales_order_allocations" USING btree ("organization_id","item_id") WHERE status = 'active';--> statement-breakpoint DROP POLICY IF EXISTS "sales_order_allocations_org_isolation" ON "sales"."sales_order_allocations";--> statement-breakpoint
ALTER TABLE "sales"."sales_order_allocations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint DROP POLICY IF EXISTS "sales_order_allocations_org_isolation" ON "sales"."sales_order_allocations";--> statement-breakpoint
CREATE POLICY "sales_order_allocations_org_isolation" ON "sales"."sales_order_allocations" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sales"."sales_order_allocations" TO app_user;
