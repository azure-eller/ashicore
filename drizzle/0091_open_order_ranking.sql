ALTER TABLE "sales"."sales_orders" ADD COLUMN IF NOT EXISTS "priority_rank" integer;--> statement-breakpoint
WITH ranked_orders AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "organization_id"
      ORDER BY
        "priority_rank" ASC NULLS LAST,
        "ship_date" ASC NULLS LAST,
        "requested_date" ASC NULLS LAST,
        "order_date" ASC NULLS LAST,
        "order_number" ASC,
        "id" ASC
    ) AS "next_rank"
  FROM "sales"."sales_orders"
  WHERE "deleted_at" IS NULL
    AND "status" IN ('draft', 'confirmed', 'partially_shipped')
)
UPDATE "sales"."sales_orders" AS "orders"
SET
  "priority_rank" = "ranked_orders"."next_rank",
  "updated_at" = now()
FROM "ranked_orders"
WHERE "orders"."id" = "ranked_orders"."id";--> statement-breakpoint
UPDATE "sales"."sales_orders"
SET
  "priority_rank" = NULL,
  "updated_at" = now()
WHERE "priority_rank" IS NOT NULL
  AND ("deleted_at" IS NOT NULL OR "status" NOT IN ('draft', 'confirmed', 'partially_shipped'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_orders_priority_rank_idx" ON "sales"."sales_orders" USING btree ("organization_id","status","priority_rank") WHERE deleted_at IS NULL AND priority_rank IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_orders_open_priority_rank_uidx" ON "sales"."sales_orders" USING btree ("organization_id","priority_rank") WHERE deleted_at IS NULL AND priority_rank IS NOT NULL AND status IN ('draft', 'confirmed', 'partially_shipped');--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" DROP CONSTRAINT IF EXISTS "sales_orders_priority_rank_positive_check";--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ADD CONSTRAINT "sales_orders_priority_rank_positive_check" CHECK ("priority_rank" > 0);--> statement-breakpoint
DROP INDEX IF EXISTS "manufacturing"."manufacturing_orders_active_priority_rank_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "manufacturing_orders_active_priority_rank_uidx" ON "manufacturing"."manufacturing_orders" USING btree ("organization_id","priority_rank") WHERE deleted_at IS NULL AND priority_rank IS NOT NULL AND status IN ('draft', 'released');
