ALTER TABLE "manufacturing"."manufacturing_order_outputs" ADD COLUMN IF NOT EXISTS "reversed_quantity" numeric(12, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
-- Backfill: attribute existing reversal totals to source rows using the same
-- newest-first walk the code performed until now. Exact for every history
-- without post-reversal outputs; current production data is single-location,
-- where attribution differences have no physical effect.
UPDATE "manufacturing"."manufacturing_order_outputs" o
SET "reversed_quantity" = LEAST(o."quantity", GREATEST(0, w.total_reversed - COALESCE(w.newer_quantity, 0)))
FROM (
  SELECT p."id",
         SUM(p."quantity") OVER (
           PARTITION BY p."manufacturing_order_id", p."manufacturing_order_batch_id"
           ORDER BY p."output_number" DESC
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ) AS newer_quantity,
         r.total_reversed
  FROM "manufacturing"."manufacturing_order_outputs" p
  JOIN (
    SELECT "manufacturing_order_id", "manufacturing_order_batch_id", -SUM("quantity") AS total_reversed
    FROM "manufacturing"."manufacturing_order_outputs"
    WHERE "quantity" < 0
    GROUP BY "manufacturing_order_id", "manufacturing_order_batch_id"
  ) r
    ON r."manufacturing_order_id" = p."manufacturing_order_id"
   AND r."manufacturing_order_batch_id" IS NOT DISTINCT FROM p."manufacturing_order_batch_id"
  WHERE p."quantity" > 0
) w
WHERE w."id" = o."id";
