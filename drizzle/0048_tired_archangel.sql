CREATE TABLE IF NOT EXISTS "inventory"."inventory_demands_summary" (
	"organization_id" text NOT NULL,
	"location_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"reference_type" varchar(64) NOT NULL,
	"reference_id" uuid NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_demands_summary_pk" PRIMARY KEY("organization_id","location_id","item_id","reference_type","reference_id")
);
--> statement-breakpoint
ALTER TABLE "inventory"."inventory_demands_summary" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT IF EXISTS "inventory_events_event_type_check";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT IF EXISTS "inventory_events_non_stock_cost_blank_check";--> statement-breakpoint
DROP INDEX IF EXISTS "inventory"."inventory_lot_balances_fifo_idx";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_item_balances" ADD COLUMN IF NOT EXISTS "demand_qty" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory"."inventory_item_balances" ADD COLUMN IF NOT EXISTS "shortage_qty" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory"."inventory_lot_balances" ADD COLUMN IF NOT EXISTS "stock_status" varchar(24) DEFAULT 'available' NOT NULL;--> statement-breakpoint ALTER TABLE "inventory"."inventory_demands_summary" DROP CONSTRAINT IF EXISTS "inventory_demands_summary_location_id_locations_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_demands_summary" ADD CONSTRAINT "inventory_demands_summary_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "inventory"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."inventory_demands_summary" DROP CONSTRAINT IF EXISTS "inventory_demands_summary_item_id_items_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_demands_summary" ADD CONSTRAINT "inventory_demands_summary_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "inventory"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_demands_summary_reference_idx" ON "inventory"."inventory_demands_summary" USING btree ("organization_id","reference_type","reference_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_lot_balances_fifo_idx" ON "inventory"."inventory_lot_balances" USING btree ("organization_id","location_id","item_id","stock_status","received_at","lot_id");--> statement-breakpoint ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT IF EXISTS "inventory_events_event_type_check";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" ADD CONSTRAINT "inventory_events_event_type_check" CHECK (event_type IN ('opening_balance', 'purchase_receipt', 'manufacturing_output', 'manual_adjustment_increase', 'stocktake_gain', 'manufacturing_variance_gain', 'manual_adjustment_decrease', 'stocktake_loss', 'sales_consumption', 'manufacturing_ingredient_consumption', 'manufacturing_variance_loss', 'unpick_restock', 'reservation_increase', 'reservation_release', 'demand_increase', 'demand_release', 'expected_increase', 'expected_release', 'cost_basis_change', 'stocktake_verification'));--> statement-breakpoint ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT IF EXISTS "inventory_events_non_stock_cost_blank_check";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" ADD CONSTRAINT "inventory_events_non_stock_cost_blank_check" CHECK (event_type NOT IN ('reservation_increase', 'reservation_release', 'demand_increase', 'demand_release', 'expected_increase', 'expected_release', 'cost_basis_change', 'stocktake_verification') OR (lot_id IS NULL AND unit_cost IS NULL AND extended_cost IS NULL));--> statement-breakpoint ALTER TABLE "inventory"."inventory_lot_balances" DROP CONSTRAINT IF EXISTS "inventory_lot_balances_stock_status_check";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_lot_balances" ADD CONSTRAINT "inventory_lot_balances_stock_status_check" CHECK (stock_status IN ('available', 'held', 'quarantined'));--> statement-breakpoint DROP POLICY IF EXISTS "inventory_demands_summary_org_isolation" ON "inventory"."inventory_demands_summary";--> statement-breakpoint
CREATE POLICY "inventory_demands_summary_org_isolation" ON "inventory"."inventory_demands_summary" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
ALTER TABLE "inventory"."inventory_demands_summary" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."inventory_demands_summary" TO app_user;
--> statement-breakpoint
INSERT INTO "inventory"."inventory_events" (
  "organization_id",
  "location_id",
  "event_type",
  "event_subtype",
  "item_id",
  "quantity",
  "reference_type",
  "reference_id",
  "metadata"
)
SELECT
  reservations."organization_id",
  reservations."location_id",
  'demand_increase',
  'migration_backfill',
  reservations."item_id",
  reservations."quantity",
  reservations."reference_type",
  reservations."reference_id",
  jsonb_build_object('migration', '0048_tired_archangel')
FROM "inventory"."inventory_reservations_summary" reservations
WHERE reservations."quantity" > 0
  AND NOT EXISTS (
    SELECT 1
    FROM "inventory"."inventory_events" events
    WHERE events."organization_id" = reservations."organization_id"
      AND events."location_id" = reservations."location_id"
      AND events."item_id" = reservations."item_id"
      AND events."event_type" = 'demand_increase'
      AND events."reference_type" = reservations."reference_type"
      AND events."reference_id" = reservations."reference_id"
      AND events."metadata" ->> 'migration' = '0048_tired_archangel'
  );
--> statement-breakpoint
INSERT INTO "inventory"."inventory_demands_summary" (
  "organization_id",
  "location_id",
  "item_id",
  "reference_type",
  "reference_id",
  "quantity"
)
SELECT
  reservations."organization_id",
  reservations."location_id",
  reservations."item_id",
  reservations."reference_type",
  reservations."reference_id",
  reservations."quantity"
FROM "inventory"."inventory_reservations_summary" reservations
WHERE reservations."quantity" > 0
ON CONFLICT (
  "organization_id",
  "location_id",
  "item_id",
  "reference_type",
  "reference_id"
) DO UPDATE SET
  "quantity" = GREATEST(
    "inventory_demands_summary"."quantity",
    excluded."quantity"
  ),
  "updated_at" = now();
--> statement-breakpoint
WITH
lot_totals AS (
  SELECT
    "organization_id",
    "location_id",
    "item_id",
    COALESCE(SUM("quantity"), 0)::numeric(18, 4) AS "reservable_qty"
  FROM "inventory"."inventory_lot_balances"
  WHERE "stock_status" = 'available'
    AND "quantity" > 0
  GROUP BY "organization_id", "location_id", "item_id"
),
reservation_rows AS (
  SELECT
    reservations."organization_id",
    reservations."location_id",
    reservations."item_id",
    reservations."reference_type",
    reservations."reference_id",
    reservations."quantity",
    COALESCE(lot_totals."reservable_qty", 0)::numeric(18, 4) AS "reservable_qty",
    COALESCE(
      SUM(reservations."quantity") OVER (
        PARTITION BY reservations."organization_id", reservations."location_id", reservations."item_id"
        ORDER BY reservations."created_at", reservations."reference_type", reservations."reference_id"
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ),
      0
    )::numeric(18, 4) AS "prior_qty"
  FROM "inventory"."inventory_reservations_summary" reservations
  LEFT JOIN lot_totals
    ON lot_totals."organization_id" = reservations."organization_id"
   AND lot_totals."location_id" = reservations."location_id"
   AND lot_totals."item_id" = reservations."item_id"
  WHERE reservations."quantity" > 0
),
clamped AS (
  SELECT
    "organization_id",
    "location_id",
    "item_id",
    "reference_type",
    "reference_id",
    "quantity",
    GREATEST(
      0,
      LEAST("quantity", "reservable_qty" - "prior_qty")
    )::numeric(18, 4) AS "keep_qty"
  FROM reservation_rows
),
released AS (
  SELECT
    *,
    ("quantity" - "keep_qty")::numeric(18, 4) AS "release_qty"
  FROM clamped
  WHERE "quantity" > "keep_qty"
),
release_events AS (
  INSERT INTO "inventory"."inventory_events" (
    "organization_id",
    "location_id",
    "event_type",
    "event_subtype",
    "item_id",
    "quantity",
    "reference_type",
    "reference_id",
    "metadata"
  )
  SELECT
    released."organization_id",
    released."location_id",
    'reservation_release',
    'migration_clamp',
    released."item_id",
    released."release_qty",
    released."reference_type",
    released."reference_id",
    jsonb_build_object('migration', '0048_tired_archangel')
  FROM released
  WHERE released."release_qty" > 0
  RETURNING 1
),
updated_reservations AS (
  UPDATE "inventory"."inventory_reservations_summary" reservations
  SET
    "quantity" = released."keep_qty",
    "updated_at" = now()
  FROM released
  WHERE reservations."organization_id" = released."organization_id"
    AND reservations."location_id" = released."location_id"
    AND reservations."item_id" = released."item_id"
    AND reservations."reference_type" = released."reference_type"
    AND reservations."reference_id" = released."reference_id"
  RETURNING reservations.*
)
DELETE FROM "inventory"."inventory_reservations_summary"
WHERE "quantity" <= 0;
--> statement-breakpoint
WITH
demand_totals AS (
  SELECT
    "organization_id",
    "location_id",
    "item_id",
    COALESCE(SUM("quantity"), 0)::numeric(18, 4) AS "demand_qty"
  FROM "inventory"."inventory_demands_summary"
  GROUP BY "organization_id", "location_id", "item_id"
),
reservation_totals AS (
  SELECT
    "organization_id",
    "location_id",
    "item_id",
    COALESCE(SUM("quantity"), 0)::numeric(18, 4) AS "committed_qty"
  FROM "inventory"."inventory_reservations_summary"
  GROUP BY "organization_id", "location_id", "item_id"
),
reservable_totals AS (
  SELECT
    "organization_id",
    "location_id",
    "item_id",
    COALESCE(SUM("quantity"), 0)::numeric(18, 4) AS "reservable_on_hand_qty"
  FROM "inventory"."inventory_lot_balances"
  WHERE "stock_status" = 'available'
    AND "quantity" > 0
  GROUP BY "organization_id", "location_id", "item_id"
),
balance_totals AS (
  SELECT
    balances."organization_id",
    balances."location_id",
    balances."item_id",
    COALESCE(demand_totals."demand_qty", 0)::numeric(18, 4) AS "demand_qty",
    COALESCE(reservation_totals."committed_qty", 0)::numeric(18, 4) AS "committed_qty",
    COALESCE(reservable_totals."reservable_on_hand_qty", 0)::numeric(18, 4) AS "reservable_on_hand_qty"
  FROM "inventory"."inventory_item_balances" balances
  LEFT JOIN demand_totals
    ON demand_totals."organization_id" = balances."organization_id"
   AND demand_totals."location_id" = balances."location_id"
   AND demand_totals."item_id" = balances."item_id"
  LEFT JOIN reservation_totals
    ON reservation_totals."organization_id" = balances."organization_id"
   AND reservation_totals."location_id" = balances."location_id"
   AND reservation_totals."item_id" = balances."item_id"
  LEFT JOIN reservable_totals
    ON reservable_totals."organization_id" = balances."organization_id"
   AND reservable_totals."location_id" = balances."location_id"
   AND reservable_totals."item_id" = balances."item_id"
)
UPDATE "inventory"."inventory_item_balances" balances
SET
  "demand_qty" = balance_totals."demand_qty",
  "committed_qty" = balance_totals."committed_qty",
  "shortage_qty" = GREATEST(
    0,
    balance_totals."demand_qty" - balance_totals."committed_qty"
  ),
  "available_to_promise" =
    balance_totals."reservable_on_hand_qty"
    - balance_totals."demand_qty"
    + balances."expected_qty",
  "updated_at" = now()
FROM balance_totals
WHERE balances."organization_id" = balance_totals."organization_id"
  AND balances."location_id" = balance_totals."location_id"
  AND balances."item_id" = balance_totals."item_id";
