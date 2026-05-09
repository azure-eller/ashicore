ALTER TABLE "manufacturing"."manufacturing_orders"
  ADD COLUMN IF NOT EXISTS "priority_rank" integer;

CREATE INDEX IF NOT EXISTS "manufacturing_orders_priority_rank_idx"
  ON "manufacturing"."manufacturing_orders" ("organization_id", "status", "priority_rank")
  WHERE deleted_at IS NULL AND priority_rank IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "manufacturing_orders_active_priority_rank_uidx"
  ON "manufacturing"."manufacturing_orders" ("organization_id", "priority_rank")
  WHERE deleted_at IS NULL
    AND priority_rank IS NOT NULL
    AND status IN ('draft', 'released');

ALTER TABLE "manufacturing"."manufacturing_orders"
  DROP CONSTRAINT IF EXISTS "manufacturing_orders_priority_rank_positive_check";

ALTER TABLE "manufacturing"."manufacturing_orders"
  ADD CONSTRAINT "manufacturing_orders_priority_rank_positive_check"
  CHECK ("priority_rank" > 0);
