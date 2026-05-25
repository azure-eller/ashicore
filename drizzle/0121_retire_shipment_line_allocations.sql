DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "inventory"."stock_allocations" allocation
    LEFT JOIN "sales"."sales_shipment_lines" shipment_line
      ON shipment_line."id" = allocation."demand_id"
    WHERE allocation."demand_type" = 'sales_shipment_line'
      AND allocation."status" = 'active'
      AND shipment_line."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot migrate active sales_shipment_line allocations with missing shipment lines';
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    WITH shipped AS (
      SELECT
        shipment_line."sales_order_line_id",
        COALESCE(SUM(shipment_line."quantity"), 0) AS shipped_qty
      FROM "sales"."sales_shipment_lines" shipment_line
      INNER JOIN "sales"."sales_shipments" shipment
        ON shipment."id" = shipment_line."sales_shipment_id"
      WHERE shipment."status" = 'shipped'
      GROUP BY shipment_line."sales_order_line_id"
    ),
    active_totals AS (
      SELECT
        allocation."organization_id",
        COALESCE(shipment_line."sales_order_line_id", allocation."demand_id") AS sales_order_line_id,
        allocation."item_id",
        COALESCE(SUM(allocation."quantity"), 0) AS allocation_qty
      FROM "inventory"."stock_allocations" allocation
      LEFT JOIN "sales"."sales_shipment_lines" shipment_line
        ON allocation."demand_type" = 'sales_shipment_line'
       AND shipment_line."id" = allocation."demand_id"
      WHERE allocation."status" = 'active'
        AND allocation."demand_type" IN ('sales_order_line', 'sales_shipment_line')
      GROUP BY
        allocation."organization_id",
        COALESCE(shipment_line."sales_order_line_id", allocation."demand_id"),
        allocation."item_id"
    )
    SELECT 1
    FROM active_totals active
    INNER JOIN "sales"."sales_order_lines" sales_line
      ON sales_line."id" = active.sales_order_line_id
    LEFT JOIN shipped
      ON shipped."sales_order_line_id" = sales_line."id"
    WHERE active.allocation_qty >
      GREATEST(
        sales_line."quantity" - sales_line."cancelled_quantity" - COALESCE(shipped.shipped_qty, 0),
        0
      )
  ) THEN
    RAISE EXCEPTION 'Cannot migrate sales_shipment_line allocations because active allocations exceed remaining parent sales-line demand';
  END IF;
END $$;
--> statement-breakpoint

CREATE TEMP TABLE "_shipment_line_allocation_rollup" ON COMMIT DROP AS
SELECT
  allocation."organization_id",
  shipment_line."sales_order_line_id" AS "demand_id",
  allocation."item_id",
  allocation."source_type",
  allocation."source_id",
  SUM(allocation."quantity") AS "quantity",
  MIN(allocation."created_by") AS "created_by",
  MIN(allocation."updated_by") AS "updated_by",
  MIN(allocation."source_label_snapshot") AS "source_label_snapshot",
  MIN(allocation."demand_label_snapshot") AS "demand_label_snapshot",
  MIN(allocation."notes") AS "notes",
  MIN(allocation."created_at") AS "created_at"
FROM "inventory"."stock_allocations" allocation
INNER JOIN "sales"."sales_shipment_lines" shipment_line
  ON shipment_line."id" = allocation."demand_id"
WHERE allocation."demand_type" = 'sales_shipment_line'
  AND allocation."status" = 'active'
GROUP BY
  allocation."organization_id",
  shipment_line."sales_order_line_id",
  allocation."item_id",
  allocation."source_type",
  allocation."source_id";
--> statement-breakpoint

UPDATE "inventory"."stock_allocations" target
SET
  "quantity" = target."quantity" + rollup."quantity",
  "updated_by" = COALESCE(rollup."updated_by", target."updated_by"),
  "updated_at" = now()
FROM "_shipment_line_allocation_rollup" rollup
WHERE target."organization_id" = rollup."organization_id"
  AND target."demand_type" = 'sales_order_line'
  AND target."demand_id" = rollup."demand_id"
  AND target."item_id" = rollup."item_id"
  AND target."source_type" = rollup."source_type"
  AND target."source_id" = rollup."source_id"
  AND target."status" = 'active';
--> statement-breakpoint

INSERT INTO "inventory"."stock_allocations" (
  "organization_id",
  "demand_type",
  "demand_id",
  "item_id",
  "source_type",
  "source_id",
  "quantity",
  "status",
  "source_label_snapshot",
  "demand_label_snapshot",
  "notes",
  "created_by",
  "updated_by",
  "created_at",
  "updated_at"
)
SELECT
  rollup."organization_id",
  'sales_order_line',
  rollup."demand_id",
  rollup."item_id",
  rollup."source_type",
  rollup."source_id",
  rollup."quantity",
  'active',
  rollup."source_label_snapshot",
  rollup."demand_label_snapshot",
  rollup."notes",
  rollup."created_by",
  rollup."updated_by",
  rollup."created_at",
  now()
FROM "_shipment_line_allocation_rollup" rollup
WHERE NOT EXISTS (
  SELECT 1
  FROM "inventory"."stock_allocations" target
  WHERE target."organization_id" = rollup."organization_id"
    AND target."demand_type" = 'sales_order_line'
    AND target."demand_id" = rollup."demand_id"
    AND target."item_id" = rollup."item_id"
    AND target."source_type" = rollup."source_type"
    AND target."source_id" = rollup."source_id"
    AND target."status" = 'active'
);
--> statement-breakpoint

UPDATE "inventory"."stock_allocations"
SET
  "status" = 'cancelled',
  "cancelled_at" = now(),
  "updated_at" = now(),
  "notes" = CONCAT_WS(
    E'\n',
    NULLIF("notes", ''),
    'Migrated active shipment-line allocation to parent sales order line.',
    jsonb_build_object(
      'migration', 'retire_sales_shipment_line_allocations',
      'prior_demand_type', 'sales_shipment_line',
      'prior_demand_id', "demand_id"
    )::text
  )
WHERE "demand_type" = 'sales_shipment_line'
  AND "status" = 'active';
--> statement-breakpoint

ALTER TABLE "inventory"."stock_allocations"
  DROP CONSTRAINT IF EXISTS "stock_allocations_demand_type_check";
--> statement-breakpoint

ALTER TABLE "inventory"."stock_allocations"
  ADD CONSTRAINT "stock_allocations_demand_type_check"
  CHECK (
    "stock_allocations"."status" <> 'active'
    OR "stock_allocations"."demand_type" IN ('sales_order_line', 'manufacturing_order_ingredient')
  );
