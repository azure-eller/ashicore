CREATE TABLE IF NOT EXISTS "inventory"."quality_disposition_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"inventory_event_id" uuid NOT NULL,
	"decision" varchar(32) NOT NULL,
	"from_disposition" varchar(24) NOT NULL,
	"to_disposition" varchar(24),
	"quantity" numeric(18, 4) NOT NULL,
	"reference_type" varchar(64),
	"reference_id" uuid,
	"notes" text,
	"actor_user_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quality_disposition_events_decision_check" CHECK (decision IN ('release', 'block', 'reject', 'scrap')),
	CONSTRAINT "quality_disposition_events_disposition_check" CHECK (from_disposition IN ('available', 'blocked', 'rejected')
          AND (to_disposition IS NULL OR to_disposition IN ('available', 'blocked', 'rejected'))),
	CONSTRAINT "quality_disposition_events_quantity_check" CHECK (quantity > 0)
);
--> statement-breakpoint
ALTER TABLE "inventory"."quality_disposition_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'inventory'
      AND table_name = 'inventory_lot_balances'
      AND column_name = 'stock_status'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'inventory'
      AND table_name = 'inventory_lot_balances'
      AND column_name = 'disposition'
  ) THEN
    ALTER TABLE "inventory"."inventory_lot_balances" RENAME COLUMN "stock_status" TO "disposition";
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT IF EXISTS "inventory_events_event_type_check";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT IF EXISTS "inventory_events_lot_required_check";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT IF EXISTS "inventory_events_cost_required_check";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_lot_balances" DROP CONSTRAINT IF EXISTS "inventory_lot_balances_stock_status_check";--> statement-breakpoint
DROP INDEX IF EXISTS "inventory"."inventory_lot_balances_item_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "inventory"."inventory_lot_balances_fifo_idx";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" ADD COLUMN IF NOT EXISTS "disposition" varchar(24);--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" ADD COLUMN IF NOT EXISTS "from_disposition" varchar(24);--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" ADD COLUMN IF NOT EXISTS "to_disposition" varchar(24);--> statement-breakpoint ALTER TABLE "inventory"."quality_disposition_events" DROP CONSTRAINT IF EXISTS "quality_disposition_events_location_id_locations_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."quality_disposition_events" ADD CONSTRAINT "quality_disposition_events_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "inventory"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."quality_disposition_events" DROP CONSTRAINT IF EXISTS "quality_disposition_events_item_id_items_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."quality_disposition_events" ADD CONSTRAINT "quality_disposition_events_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "inventory"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."quality_disposition_events" DROP CONSTRAINT IF EXISTS "quality_disposition_events_lot_id_lots_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."quality_disposition_events" ADD CONSTRAINT "quality_disposition_events_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "inventory"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."quality_disposition_events" DROP CONSTRAINT IF EXISTS "quality_disposition_events_inventory_event_id_inventory_events_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."quality_disposition_events" ADD CONSTRAINT "quality_disposition_events_inventory_event_id_inventory_events_id_fk" FOREIGN KEY ("inventory_event_id") REFERENCES "inventory"."inventory_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quality_disposition_events_org_item_idx" ON "inventory"."quality_disposition_events" USING btree ("organization_id","item_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quality_disposition_events_org_lot_idx" ON "inventory"."quality_disposition_events" USING btree ("organization_id","lot_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quality_disposition_events_inventory_event_idx" ON "inventory"."quality_disposition_events" USING btree ("inventory_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_lot_balances_item_idx" ON "inventory"."inventory_lot_balances" USING btree ("organization_id","item_id","location_id","disposition");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_lot_balances_fifo_idx" ON "inventory"."inventory_lot_balances" USING btree ("organization_id","location_id","item_id","disposition","received_at","lot_id");--> statement-breakpoint
UPDATE "inventory"."inventory_lot_balances"
SET "disposition" = CASE
  WHEN "disposition" IN ('held', 'quarantined', 'quarantine', 'hold') THEN 'blocked'
  ELSE "disposition"
END
WHERE "disposition" IN ('held', 'quarantined', 'quarantine', 'hold');
--> statement-breakpoint
ALTER TABLE "inventory"."inventory_lot_balances" DROP CONSTRAINT IF EXISTS "inventory_lot_balances_pk";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_lot_balances" ADD CONSTRAINT "inventory_lot_balances_pk" PRIMARY KEY("organization_id","item_id","location_id","lot_id","disposition");--> statement-breakpoint ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT IF EXISTS "inventory_events_disposition_check";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" ADD CONSTRAINT "inventory_events_disposition_check" CHECK ((disposition IS NULL OR disposition IN ('available', 'blocked', 'rejected'))
          AND (from_disposition IS NULL OR from_disposition IN ('available', 'blocked', 'rejected'))
          AND (to_disposition IS NULL OR to_disposition IN ('available', 'blocked', 'rejected')));--> statement-breakpoint ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT IF EXISTS "inventory_events_quality_disposition_check";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" ADD CONSTRAINT "inventory_events_quality_disposition_check" CHECK (CASE
          WHEN event_type = 'quality_disposition_change'
            THEN from_disposition IS NOT NULL
              AND to_disposition IS NOT NULL
              AND from_disposition <> to_disposition
          WHEN event_type = 'quality_scrap'
            THEN from_disposition IS NOT NULL
              AND to_disposition IS NULL
          ELSE true
        END);--> statement-breakpoint ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT IF EXISTS "inventory_events_event_type_check";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" ADD CONSTRAINT "inventory_events_event_type_check" CHECK (event_type IN ('opening_balance', 'purchase_receipt', 'manufacturing_output', 'manual_adjustment_increase', 'stocktake_gain', 'manufacturing_variance_gain', 'manual_adjustment_decrease', 'stocktake_loss', 'sales_consumption', 'manufacturing_ingredient_consumption', 'manufacturing_variance_loss', 'quality_scrap', 'unpick_restock', 'quality_disposition_change', 'reservation_increase', 'reservation_release', 'demand_increase', 'demand_release', 'expected_increase', 'expected_release', 'cost_basis_change', 'stocktake_verification'));--> statement-breakpoint ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT IF EXISTS "inventory_events_lot_required_check";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" ADD CONSTRAINT "inventory_events_lot_required_check" CHECK (event_type NOT IN ('opening_balance', 'purchase_receipt', 'manufacturing_output', 'manual_adjustment_increase', 'stocktake_gain', 'manufacturing_variance_gain', 'manual_adjustment_decrease', 'stocktake_loss', 'sales_consumption', 'manufacturing_ingredient_consumption', 'manufacturing_variance_loss', 'quality_scrap', 'unpick_restock', 'quality_disposition_change') OR lot_id IS NOT NULL);--> statement-breakpoint ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT IF EXISTS "inventory_events_cost_required_check";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" ADD CONSTRAINT "inventory_events_cost_required_check" CHECK (event_type NOT IN ('opening_balance', 'purchase_receipt', 'manufacturing_output', 'manual_adjustment_increase', 'stocktake_gain', 'manufacturing_variance_gain', 'manual_adjustment_decrease', 'stocktake_loss', 'sales_consumption', 'manufacturing_ingredient_consumption', 'manufacturing_variance_loss', 'quality_scrap', 'unpick_restock', 'quality_disposition_change') OR (unit_cost IS NOT NULL AND extended_cost IS NOT NULL AND extended_cost = ROUND(quantity * unit_cost, 6)));--> statement-breakpoint ALTER TABLE "inventory"."inventory_lot_balances" DROP CONSTRAINT IF EXISTS "inventory_lot_balances_disposition_check";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_lot_balances" ADD CONSTRAINT "inventory_lot_balances_disposition_check" CHECK (disposition IN ('available', 'blocked', 'rejected'));--> statement-breakpoint DROP POLICY IF EXISTS "quality_disposition_events_org_isolation" ON "inventory"."quality_disposition_events";--> statement-breakpoint
CREATE POLICY "quality_disposition_events_org_isolation" ON "inventory"."quality_disposition_events" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
ALTER TABLE "inventory"."quality_disposition_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."quality_disposition_events" TO app_user;
