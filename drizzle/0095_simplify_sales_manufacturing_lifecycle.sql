ALTER TABLE "sales"."sales_orders" ALTER COLUMN "status" SET DEFAULT 'open';--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_orders" ALTER COLUMN "status" SET DEFAULT 'open';--> statement-breakpoint
UPDATE "sales"."sales_orders"
SET
  "deleted_at" = COALESCE("deleted_at", "updated_at", NOW()),
  "priority_rank" = NULL,
  "updated_at" = NOW()
WHERE "status" = 'cancelled';--> statement-breakpoint
UPDATE "sales"."sales_orders"
SET
  "status" = CASE
    WHEN "status" IN ('draft', 'confirmed', 'partially_shipped') THEN 'open'
    WHEN "status" IN ('shipped', 'cancelled') THEN 'done'
    ELSE "status"
  END,
  "updated_at" = NOW()
WHERE "status" IN ('draft', 'confirmed', 'partially_shipped', 'shipped', 'cancelled');--> statement-breakpoint
UPDATE "manufacturing"."manufacturing_orders"
SET
  "deleted_at" = COALESCE("deleted_at", "cancelled_at", "updated_at", NOW()),
  "priority_rank" = NULL,
  "updated_at" = NOW()
WHERE "status" = 'cancelled';--> statement-breakpoint
UPDATE "manufacturing"."manufacturing_orders"
SET
  "status" = CASE
    WHEN "status" IN ('draft', 'released') THEN 'open'
    WHEN "status" IN ('completed', 'cancelled') THEN 'done'
    ELSE "status"
  END,
  "updated_at" = NOW()
WHERE "status" IN ('draft', 'released', 'completed', 'cancelled');--> statement-breakpoint
DROP INDEX IF EXISTS "sales"."sales_orders_open_priority_rank_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_orders_open_priority_rank_uidx" ON "sales"."sales_orders" USING btree ("organization_id","priority_rank") WHERE deleted_at IS NULL AND priority_rank IS NOT NULL AND status = 'open';--> statement-breakpoint
DROP INDEX IF EXISTS "manufacturing"."manufacturing_orders_active_priority_rank_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "manufacturing_orders_active_priority_rank_uidx" ON "manufacturing"."manufacturing_orders" USING btree ("organization_id","priority_rank") WHERE deleted_at IS NULL AND priority_rank IS NOT NULL AND status = 'open';
