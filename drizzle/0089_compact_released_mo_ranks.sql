DROP INDEX IF EXISTS "manufacturing"."manufacturing_orders_active_priority_rank_uidx";--> statement-breakpoint
WITH ranked_orders AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "organization_id"
      ORDER BY
        "priority_rank" ASC NULLS LAST,
        "released_at" ASC NULLS LAST,
        "order_number" ASC,
        "id" ASC
    ) AS "next_rank"
  FROM "manufacturing"."manufacturing_orders"
  WHERE "deleted_at" IS NULL
    AND "status" = 'released'
)
UPDATE "manufacturing"."manufacturing_orders" AS "orders"
SET
  "priority_rank" = "ranked_orders"."next_rank",
  "updated_at" = NOW()
FROM "ranked_orders"
WHERE "orders"."id" = "ranked_orders"."id";--> statement-breakpoint
UPDATE "manufacturing"."manufacturing_orders"
SET
  "priority_rank" = NULL,
  "updated_at" = NOW()
WHERE "priority_rank" IS NOT NULL
  AND "status" <> 'released';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "manufacturing_orders_active_priority_rank_uidx" ON "manufacturing"."manufacturing_orders" USING btree ("organization_id","priority_rank") WHERE deleted_at IS NULL AND priority_rank IS NOT NULL AND status = 'released';
