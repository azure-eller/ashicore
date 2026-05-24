ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  DROP CONSTRAINT IF EXISTS "manufacturing_order_ingredients_lot_strategy_check";

ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  ADD CONSTRAINT "manufacturing_order_ingredients_lot_strategy_check"
  CHECK (lot_strategy IN ('fifo', 'lifo', 'custom'));
