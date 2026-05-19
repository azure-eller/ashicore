ALTER TABLE "inventory"."items" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY family_id
      ORDER BY created_at ASC, id ASC
    ) - 1 AS next_sort_order
  FROM "inventory"."items"
  WHERE family_id IS NOT NULL
)
UPDATE "inventory"."items"
SET sort_order = ranked.next_sort_order
FROM ranked
WHERE "inventory"."items".id = ranked.id;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_family_sort_order_idx" ON "inventory"."items" USING btree ("family_id","sort_order") WHERE family_id IS NOT NULL;--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "inventory"."internal_barcode_seq" START WITH 10000;--> statement-breakpoint
SELECT setval(
  'inventory.internal_barcode_seq',
  GREATEST(
    (
      SELECT COALESCE(MAX(internal_barcode::bigint), 9999)
      FROM "inventory"."items"
      WHERE internal_barcode ~ '^[0-9]+$'
    ),
    9999
  ),
  true
);--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "inventory"."internal_barcode_seq" TO app_user;
