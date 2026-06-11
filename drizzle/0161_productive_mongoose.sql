CREATE TABLE IF NOT EXISTS "inventory"."transfer_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory"."transfer_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory"."transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"from_location_id" uuid NOT NULL,
	"to_location_id" uuid NOT NULL,
	"note" text,
	"created_by_user_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory"."transfers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."transfer_lines" DROP CONSTRAINT IF EXISTS "transfer_lines_transfer_id_transfers_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."transfer_lines" ADD CONSTRAINT "transfer_lines_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "inventory"."transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."transfer_lines" DROP CONSTRAINT IF EXISTS "transfer_lines_item_id_items_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."transfer_lines" ADD CONSTRAINT "transfer_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "inventory"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."transfers" DROP CONSTRAINT IF EXISTS "transfers_from_location_id_locations_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."transfers" ADD CONSTRAINT "transfers_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "inventory"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."transfers" DROP CONSTRAINT IF EXISTS "transfers_to_location_id_locations_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."transfers" ADD CONSTRAINT "transfers_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "inventory"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_transfer_lines_transfer_id_idx" ON "inventory"."transfer_lines" USING btree ("transfer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_transfer_lines_item_id_idx" ON "inventory"."transfer_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_transfers_org_idx" ON "inventory"."transfers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_transfers_org_occurred_idx" ON "inventory"."transfers" USING btree ("organization_id","occurred_at");--> statement-breakpoint ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT IF EXISTS "inventory_events_event_type_check";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" ADD CONSTRAINT "inventory_events_event_type_check" CHECK (event_type IN ('opening_balance', 'purchase_receipt', 'manufacturing_output', 'manual_adjustment_increase', 'stocktake_gain', 'manufacturing_variance_gain', 'manual_adjustment_decrease', 'stocktake_loss', 'sales_consumption', 'manufacturing_ingredient_consumption', 'manufacturing_variance_loss', 'quality_scrap', 'unpick_restock', 'transfer_out', 'transfer_in', 'quality_disposition_change', 'demand_increase', 'demand_release', 'expected_increase', 'expected_release', 'cost_basis_change', 'landed_cost_revaluation', 'stocktake_verification'));--> statement-breakpoint ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT IF EXISTS "inventory_events_lot_required_check";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" ADD CONSTRAINT "inventory_events_lot_required_check" CHECK (event_type NOT IN ('opening_balance', 'purchase_receipt', 'manufacturing_output', 'manual_adjustment_increase', 'stocktake_gain', 'manufacturing_variance_gain', 'manual_adjustment_decrease', 'stocktake_loss', 'sales_consumption', 'manufacturing_ingredient_consumption', 'manufacturing_variance_loss', 'quality_scrap', 'unpick_restock', 'transfer_out', 'transfer_in', 'quality_disposition_change') OR lot_id IS NOT NULL);--> statement-breakpoint ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT IF EXISTS "inventory_events_cost_required_check";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" ADD CONSTRAINT "inventory_events_cost_required_check" CHECK (event_type NOT IN ('opening_balance', 'purchase_receipt', 'manufacturing_output', 'manual_adjustment_increase', 'stocktake_gain', 'manufacturing_variance_gain', 'manual_adjustment_decrease', 'stocktake_loss', 'sales_consumption', 'manufacturing_ingredient_consumption', 'manufacturing_variance_loss', 'quality_scrap', 'unpick_restock', 'transfer_out', 'transfer_in', 'quality_disposition_change') OR (unit_cost IS NOT NULL AND extended_cost IS NOT NULL AND extended_cost = ROUND(quantity * unit_cost, 6)));--> statement-breakpoint DROP POLICY IF EXISTS "inventory_transfer_lines_org_isolation" ON "inventory"."transfer_lines";--> statement-breakpoint
CREATE POLICY "inventory_transfer_lines_org_isolation" ON "inventory"."transfer_lines" AS PERMISSIVE FOR ALL TO public USING (transfer_id IN (
          SELECT id
          FROM inventory.transfers
          WHERE organization_id = current_setting('app.current_org_id', true)
        )) WITH CHECK (transfer_id IN (
          SELECT id
          FROM inventory.transfers
          WHERE organization_id = current_setting('app.current_org_id', true)
        ));--> statement-breakpoint DROP POLICY IF EXISTS "inventory_transfers_org_isolation" ON "inventory"."transfers";--> statement-breakpoint
CREATE POLICY "inventory_transfers_org_isolation" ON "inventory"."transfers" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
ALTER TABLE "inventory"."transfers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."transfer_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."transfers" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."transfer_lines" TO app_user;