ALTER TABLE "inventory"."items"
  DROP COLUMN IF EXISTS "allow_partial_manufacturing_output";

ALTER TABLE "manufacturing"."manufacturing_orders"
  DROP COLUMN IF EXISTS "allow_partial_manufacturing_output";
