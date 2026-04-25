ALTER TABLE "inventory"."items" ADD COLUMN IF NOT EXISTS "current_stock_unit_cost" numeric(18, 6);

WITH weighted_current_cost AS (
  SELECT
    item_id,
    ROUND(SUM(quantity * unit_cost) / NULLIF(SUM(quantity), 0), 6) AS current_stock_unit_cost
  FROM "inventory"."inventory_lot_balances"
  WHERE quantity > 0
    AND unit_cost IS NOT NULL
  GROUP BY item_id
  HAVING SUM(quantity) > 0
)
UPDATE "inventory"."items"
SET "current_stock_unit_cost" = weighted_current_cost.current_stock_unit_cost
FROM weighted_current_cost
WHERE "items"."id" = weighted_current_cost.item_id
  AND "items"."item_type" = 'material'
  AND "items"."current_stock_unit_cost" IS NULL;
