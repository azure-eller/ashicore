CREATE TABLE IF NOT EXISTS "purchasing"."supplier_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"supplier_sku" varchar(100),
	"unit_cost" numeric(10, 4),
	"purchase_unit_definition_id" uuid,
	"purchase_to_stock_factor" numeric(12, 4),
	"lead_time_days_override" numeric(8, 2),
	"minimum_order_quantity" numeric(12, 4),
	"order_multiple" numeric(12, 4),
	"is_preferred" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchasing"."supplier_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD COLUMN IF NOT EXISTS "reorder_point" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD COLUMN IF NOT EXISTS "target_cover_days" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD COLUMN IF NOT EXISTS "planning_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD COLUMN IF NOT EXISTS "lead_time_days_override" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD COLUMN IF NOT EXISTS "production_lead_time_days" numeric(8, 2);--> statement-breakpoint ALTER TABLE "purchasing"."supplier_items" DROP CONSTRAINT IF EXISTS "supplier_items_supplier_id_suppliers_id_fk";--> statement-breakpoint
ALTER TABLE "purchasing"."supplier_items" ADD CONSTRAINT "supplier_items_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "purchasing"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "purchasing"."supplier_items" DROP CONSTRAINT IF EXISTS "supplier_items_item_id_items_id_fk";--> statement-breakpoint
ALTER TABLE "purchasing"."supplier_items" ADD CONSTRAINT "supplier_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "inventory"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "purchasing"."supplier_items" DROP CONSTRAINT IF EXISTS "supplier_items_purchase_unit_definition_id_unit_definitions_id_fk";--> statement-breakpoint
ALTER TABLE "purchasing"."supplier_items" ADD CONSTRAINT "supplier_items_purchase_unit_definition_id_unit_definitions_id_fk" FOREIGN KEY ("purchase_unit_definition_id") REFERENCES "inventory"."unit_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_items_org_id_idx" ON "purchasing"."supplier_items" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_items_supplier_id_idx" ON "purchasing"."supplier_items" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_items_item_id_idx" ON "purchasing"."supplier_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_items_active_idx" ON "purchasing"."supplier_items" USING btree ("organization_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_items_org_supplier_item_uidx" ON "purchasing"."supplier_items" USING btree ("organization_id","supplier_id","item_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_items_org_preferred_item_uidx" ON "purchasing"."supplier_items" USING btree ("organization_id","item_id") WHERE deleted_at IS NULL AND is_preferred = true;--> statement-breakpoint DROP POLICY IF EXISTS "supplier_items_org_isolation" ON "purchasing"."supplier_items";--> statement-breakpoint
CREATE POLICY "supplier_items_org_isolation" ON "purchasing"."supplier_items" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
ALTER TABLE "purchasing"."supplier_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "purchasing"."supplier_items" TO app_user;
