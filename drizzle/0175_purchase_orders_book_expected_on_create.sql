ALTER TABLE "purchasing"."purchase_orders" ALTER COLUMN "status" SET DEFAULT 'not_received';
--> statement-breakpoint
CREATE TEMP TABLE "_po_draft_expected_backfill" ON COMMIT DROP AS
WITH draft_lines AS (
  SELECT
    po."organization_id",
    po."id" AS "purchase_order_id",
    line."id" AS "purchase_order_line_id",
    line."item_id",
    GREATEST(
      line."stock_quantity_ordered" - line."stock_quantity_received",
      0
    )::numeric(18, 4) AS "quantity"
  FROM "purchasing"."purchase_orders" po
  JOIN "purchasing"."purchase_order_lines" line
    ON line."purchase_order_id" = po."id"
  WHERE po."status" = 'draft'
    AND po."type" = 'standard'
    AND po."deleted_at" IS NULL
)
SELECT *
FROM draft_lines
WHERE "quantity" > 0;
--> statement-breakpoint
INSERT INTO "inventory"."locations" (
  "organization_id",
  "name",
  "code",
  "is_default"
)
SELECT DISTINCT
  draft_lines."organization_id",
  'Main',
  'main',
  true
FROM "_po_draft_expected_backfill" draft_lines
WHERE NOT EXISTS (
  SELECT 1
  FROM "inventory"."locations" location
  WHERE location."organization_id" = draft_lines."organization_id"
    AND location."is_default" = true
    AND location."deleted_at" IS NULL
)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "purchasing"."purchase_orders" po
    JOIN "purchasing"."purchase_order_lines" line
      ON line."purchase_order_id" = po."id"
    LEFT JOIN "inventory"."locations" location
      ON location."organization_id" = po."organization_id"
     AND location."is_default" = true
     AND location."deleted_at" IS NULL
    LEFT JOIN "inventory"."inventory_expected_summary" expected
      ON expected."organization_id" = po."organization_id"
     AND expected."location_id" = location."id"
     AND expected."item_id" = line."item_id"
     AND expected."reference_type" = 'purchase_order_line'
     AND expected."reference_id" = line."id"
    WHERE po."status" IN ('ordered', 'partial')
      AND po."type" = 'standard'
      AND po."deleted_at" IS NULL
      AND GREATEST(
        line."stock_quantity_ordered" - line."stock_quantity_received",
        0
      ) > 0
      AND expected."reference_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot backfill purchase-order drafts: existing ordered/partial PO lines are missing expected supply summaries.';
  END IF;
END $$;
--> statement-breakpoint
UPDATE "purchasing"."purchase_orders"
SET
  "status" = 'not_received',
  "ordered_at" = COALESCE("ordered_at", now()),
  "updated_at" = now()
WHERE "status" = 'draft';
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "purchasing"."purchase_orders" po
    JOIN "purchasing"."purchase_order_lines" line
      ON line."purchase_order_id" = po."id"
    JOIN "inventory"."inventory_expected_summary" expected
      ON expected."organization_id" = po."organization_id"
     AND expected."reference_type" = 'purchase_order_line'
     AND expected."reference_id" = line."id"
    WHERE po."status" = 'cancelled'
      AND po."deleted_at" IS NULL
      AND ROUND(expected."quantity"::numeric, 4) <> 0
  ) THEN
    RAISE EXCEPTION 'Cannot normalize legacy cancelled purchase orders: cancelled PO lines still have expected supply summaries.';
  END IF;
END $$;
--> statement-breakpoint
UPDATE "purchasing"."purchase_orders"
SET
  "status" = 'not_received',
  "deleted_at" = COALESCE("deleted_at", now()),
  "updated_at" = now()
WHERE "status" = 'cancelled';
--> statement-breakpoint
UPDATE "purchasing"."purchase_orders"
SET
  "status" = 'not_received',
  "updated_at" = now()
WHERE "status" = 'ordered';
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
  draft_lines."organization_id",
  location."id",
  'expected_increase',
  'purchase_submit',
  draft_lines."item_id",
  draft_lines."quantity",
  'purchase_order_line',
  draft_lines."purchase_order_line_id",
  jsonb_build_object('migration', '0175_purchase_orders_book_expected_on_create')
FROM "_po_draft_expected_backfill" draft_lines
JOIN "inventory"."locations" location
  ON location."organization_id" = draft_lines."organization_id"
 AND location."is_default" = true
 AND location."deleted_at" IS NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM "inventory"."inventory_events" event
  WHERE event."organization_id" = draft_lines."organization_id"
    AND event."location_id" = location."id"
    AND event."item_id" = draft_lines."item_id"
    AND event."event_type" = 'expected_increase'
    AND event."reference_type" = 'purchase_order_line'
    AND event."reference_id" = draft_lines."purchase_order_line_id"
    AND event."metadata" ->> 'migration' = '0175_purchase_orders_book_expected_on_create'
);
--> statement-breakpoint
INSERT INTO "inventory"."inventory_expected_summary" (
  "organization_id",
  "location_id",
  "item_id",
  "reference_type",
  "reference_id",
  "quantity"
)
SELECT
  draft_lines."organization_id",
  location."id",
  draft_lines."item_id",
  'purchase_order_line',
  draft_lines."purchase_order_line_id",
  draft_lines."quantity"
FROM "_po_draft_expected_backfill" draft_lines
JOIN "inventory"."locations" location
  ON location."organization_id" = draft_lines."organization_id"
 AND location."is_default" = true
 AND location."deleted_at" IS NULL
ON CONFLICT (
  "organization_id",
  "location_id",
  "item_id",
  "reference_type",
  "reference_id"
) DO UPDATE SET
  "quantity" = excluded."quantity",
  "updated_at" = now();
--> statement-breakpoint
INSERT INTO "inventory"."inventory_item_balances" (
  "organization_id",
  "location_id",
  "item_id",
  "on_hand_qty",
  "demand_qty",
  "expected_qty",
  "available_to_promise"
)
SELECT DISTINCT
  draft_lines."organization_id",
  location."id",
  draft_lines."item_id",
  0::numeric,
  0::numeric,
  0::numeric,
  0::numeric
FROM "_po_draft_expected_backfill" draft_lines
JOIN "inventory"."locations" location
  ON location."organization_id" = draft_lines."organization_id"
 AND location."is_default" = true
 AND location."deleted_at" IS NULL
ON CONFLICT (
  "organization_id",
  "location_id",
  "item_id"
) DO NOTHING;
--> statement-breakpoint
WITH affected AS (
  SELECT DISTINCT
    draft_lines."organization_id",
    location."id" AS "location_id",
    draft_lines."item_id"
  FROM "_po_draft_expected_backfill" draft_lines
  JOIN "inventory"."locations" location
    ON location."organization_id" = draft_lines."organization_id"
   AND location."is_default" = true
   AND location."deleted_at" IS NULL
),
expected_totals AS (
  SELECT
    expected."organization_id",
    expected."location_id",
    expected."item_id",
    COALESCE(SUM(expected."quantity"), 0)::numeric(18, 4) AS "expected_qty"
  FROM "inventory"."inventory_expected_summary" expected
  JOIN affected
    ON affected."organization_id" = expected."organization_id"
   AND affected."location_id" = expected."location_id"
   AND affected."item_id" = expected."item_id"
  GROUP BY
    expected."organization_id",
    expected."location_id",
    expected."item_id"
),
available_positive_lots AS (
  SELECT
    lots."organization_id",
    lots."location_id",
    lots."item_id",
    COALESCE(SUM(lots."quantity"), 0)::numeric(18, 4) AS "quantity"
  FROM "inventory"."inventory_lot_balances" lots
  JOIN affected
    ON affected."organization_id" = lots."organization_id"
   AND affected."location_id" = lots."location_id"
   AND affected."item_id" = lots."item_id"
  WHERE lots."disposition" = 'available'
    AND lots."quantity" > 0
  GROUP BY
    lots."organization_id",
    lots."location_id",
    lots."item_id"
),
available_negative_lots AS (
  SELECT
    lots."organization_id",
    lots."location_id",
    lots."item_id",
    COALESCE(ABS(SUM(lots."quantity")), 0)::numeric(18, 4) AS "quantity"
  FROM "inventory"."inventory_lot_balances" lots
  JOIN affected
    ON affected."organization_id" = lots."organization_id"
   AND affected."location_id" = lots."location_id"
   AND affected."item_id" = lots."item_id"
  WHERE lots."disposition" = 'available'
    AND lots."quantity" < 0
  GROUP BY
    lots."organization_id",
    lots."location_id",
    lots."item_id"
)
UPDATE "inventory"."inventory_item_balances" balances
SET
  "expected_qty" = COALESCE(expected_totals."expected_qty", 0),
  "available_to_promise" =
    GREATEST(
      0,
      COALESCE(available_positive_lots."quantity", 0)
      - COALESCE(available_negative_lots."quantity", 0)
      + COALESCE(expected_totals."expected_qty", 0)
    )
    - balances."demand_qty",
  "updated_at" = now()
FROM affected
LEFT JOIN expected_totals
  ON expected_totals."organization_id" = affected."organization_id"
 AND expected_totals."location_id" = affected."location_id"
 AND expected_totals."item_id" = affected."item_id"
LEFT JOIN available_positive_lots
  ON available_positive_lots."organization_id" = affected."organization_id"
 AND available_positive_lots."location_id" = affected."location_id"
 AND available_positive_lots."item_id" = affected."item_id"
LEFT JOIN available_negative_lots
  ON available_negative_lots."organization_id" = affected."organization_id"
 AND available_negative_lots."location_id" = affected."location_id"
 AND available_negative_lots."item_id" = affected."item_id"
WHERE balances."organization_id" = affected."organization_id"
  AND balances."location_id" = affected."location_id"
  AND balances."item_id" = affected."item_id";
--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_status_check";
--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD CONSTRAINT "purchase_orders_status_check" CHECK ("status" IN ('not_received', 'partial', 'received'));
