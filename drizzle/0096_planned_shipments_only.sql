ALTER TABLE "sales"."sales_shipments" DROP CONSTRAINT IF EXISTS "sales_shipments_status_check";--> statement-breakpoint
DELETE FROM "sales"."sales_shipment_costs"
WHERE "sales_shipment_id" IN (
  SELECT "id" FROM "sales"."sales_shipments" WHERE "status" = 'cancelled'
);--> statement-breakpoint
DELETE FROM "sales"."sales_shipment_lines"
WHERE "sales_shipment_id" IN (
  SELECT "id" FROM "sales"."sales_shipments" WHERE "status" = 'cancelled'
);--> statement-breakpoint
DELETE FROM "sales"."sales_shipments"
WHERE "status" = 'cancelled';--> statement-breakpoint
UPDATE "sales"."sales_shipments"
SET "status" = 'planned', "updated_at" = NOW()
WHERE "status" = 'draft';--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" ALTER COLUMN "status" SET DEFAULT 'planned';--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" DROP CONSTRAINT IF EXISTS "sales_shipments_status_check";--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" ADD CONSTRAINT "sales_shipments_status_check" CHECK ("status" IN ('planned', 'shipped'));--> statement-breakpoint
WITH active_lot_allocations AS (
  SELECT
    "organization_id",
    "demand_id" AS "reference_id",
    "item_id",
    SUM("quantity") AS "allocated_qty"
  FROM "inventory"."stock_allocations"
  WHERE
    "demand_type" = 'sales_order_line'
    AND "source_type" = 'inventory_lot'
    AND "status" = 'active'
  GROUP BY "organization_id", "demand_id", "item_id"
),
reservation_releases AS (
  SELECT
    reservations."organization_id",
    reservations."location_id",
    reservations."item_id",
    reservations."reference_type",
    reservations."reference_id",
    GREATEST(
      reservations."quantity" - COALESCE(active_lot_allocations."allocated_qty", 0),
      0
    ) AS "quantity"
  FROM "inventory"."inventory_reservations_summary" reservations
  LEFT JOIN active_lot_allocations
    ON active_lot_allocations."organization_id" = reservations."organization_id"
    AND active_lot_allocations."reference_id" = reservations."reference_id"
    AND active_lot_allocations."item_id" = reservations."item_id"
  WHERE reservations."reference_type" = 'sales_order_line'
)
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
  "organization_id",
  "location_id",
  'reservation_release',
  'sales_allocation_refactor',
  "item_id",
  "quantity",
  "reference_type",
  "reference_id",
  '{"reason":"sales orders no longer auto-reserve stock"}'::jsonb
FROM reservation_releases
WHERE "quantity" > 0;--> statement-breakpoint
WITH active_lot_allocations AS (
  SELECT
    "organization_id",
    "demand_id" AS "reference_id",
    "item_id",
    SUM("quantity") AS "allocated_qty"
  FROM "inventory"."stock_allocations"
  WHERE
    "demand_type" = 'sales_order_line'
    AND "source_type" = 'inventory_lot'
    AND "status" = 'active'
  GROUP BY "organization_id", "demand_id", "item_id"
),
reservation_releases AS (
  SELECT
    reservations."organization_id",
    reservations."location_id",
    reservations."item_id",
    GREATEST(
      reservations."quantity" - COALESCE(active_lot_allocations."allocated_qty", 0),
      0
    ) AS "quantity"
  FROM "inventory"."inventory_reservations_summary" reservations
  LEFT JOIN active_lot_allocations
    ON active_lot_allocations."organization_id" = reservations."organization_id"
    AND active_lot_allocations."reference_id" = reservations."reference_id"
    AND active_lot_allocations."item_id" = reservations."item_id"
  WHERE reservations."reference_type" = 'sales_order_line'
),
summed AS (
  SELECT "organization_id", "location_id", "item_id", SUM("quantity") AS "quantity"
  FROM reservation_releases
  WHERE "quantity" > 0
  GROUP BY "organization_id", "location_id", "item_id"
)
UPDATE "inventory"."inventory_item_balances" balances
SET
  "committed_qty" = GREATEST(balances."committed_qty" - summed."quantity", 0),
  "shortage_qty" = GREATEST(
    0,
    balances."demand_qty" - GREATEST(balances."committed_qty" - summed."quantity", 0)
  ),
  "updated_at" = NOW()
FROM summed
WHERE
  balances."organization_id" = summed."organization_id"
  AND balances."location_id" = summed."location_id"
  AND balances."item_id" = summed."item_id";--> statement-breakpoint
WITH active_lot_allocations AS (
  SELECT
    "organization_id",
    "demand_id" AS "reference_id",
    "item_id",
    SUM("quantity") AS "allocated_qty"
  FROM "inventory"."stock_allocations"
  WHERE
    "demand_type" = 'sales_order_line'
    AND "source_type" = 'inventory_lot'
    AND "status" = 'active'
  GROUP BY "organization_id", "demand_id", "item_id"
)
UPDATE "inventory"."inventory_reservations_summary" reservations
SET
  "quantity" = active_lot_allocations."allocated_qty",
  "updated_at" = NOW()
FROM active_lot_allocations
WHERE
  reservations."reference_type" = 'sales_order_line'
  AND reservations."organization_id" = active_lot_allocations."organization_id"
  AND reservations."reference_id" = active_lot_allocations."reference_id"
  AND reservations."item_id" = active_lot_allocations."item_id"
  AND reservations."quantity" <> active_lot_allocations."allocated_qty";--> statement-breakpoint
DELETE FROM "inventory"."inventory_reservations_summary" reservations
WHERE
  reservations."reference_type" = 'sales_order_line'
  AND NOT EXISTS (
    SELECT 1
    FROM "inventory"."stock_allocations" allocations
    WHERE
      allocations."organization_id" = reservations."organization_id"
      AND allocations."demand_type" = 'sales_order_line'
      AND allocations."source_type" = 'inventory_lot'
      AND allocations."status" = 'active'
      AND allocations."demand_id" = reservations."reference_id"
      AND allocations."item_id" = reservations."item_id"
  );--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_orders" DROP COLUMN IF EXISTS "released_at";
