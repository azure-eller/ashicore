WITH candidates AS (
  SELECT
    "id",
    "organization_id",
    'PO-' ||
      COALESCE(NULLIF(ltrim(substring("order_number" from '^PO-[0-9]{4}-([0-9]+)'), '0'), ''), '0') ||
      COALESCE(substring("order_number" from '^PO-[0-9]{4}-[0-9]+(.*)$'), '') AS "next_order_number"
  FROM "purchasing"."purchase_orders"
  WHERE "deleted_at" IS NULL
    AND "status" IN ('draft', 'ordered', 'partial')
    AND "order_number" ~ '^PO-[0-9]{4}-[0-9]+.*$'
    AND COALESCE(substring("order_number" from '^PO-[0-9]{4}-[0-9]+(.*)$'), '') !~ '^-[0-9]'
), unique_candidates AS (
  SELECT *
  FROM (
    SELECT
      candidates.*,
      COUNT(*) OVER (
        PARTITION BY "organization_id", "next_order_number"
      ) AS "target_count"
    FROM candidates
  ) counted
  WHERE "target_count" = 1
), safe_candidates AS (
  SELECT unique_candidates.*
  FROM unique_candidates
  WHERE NOT EXISTS (
    SELECT 1
    FROM "purchasing"."purchase_orders" existing
    WHERE existing."organization_id" = unique_candidates."organization_id"
      AND existing."order_number" = unique_candidates."next_order_number"
      AND existing."id" <> unique_candidates."id"
  )
)
UPDATE "purchasing"."purchase_orders" target
SET "order_number" = safe_candidates."next_order_number",
    "updated_at" = now()
FROM safe_candidates
WHERE target."id" = safe_candidates."id";--> statement-breakpoint

WITH candidates AS (
  SELECT
    "id",
    "organization_id",
    'SO-' ||
      COALESCE(NULLIF(ltrim(substring("order_number" from '^SO-[0-9]{4}-([0-9]+)'), '0'), ''), '0') ||
      COALESCE(substring("order_number" from '^SO-[0-9]{4}-[0-9]+(.*)$'), '') AS "next_order_number"
  FROM "sales"."sales_orders"
  WHERE "deleted_at" IS NULL
    AND "status" <> 'done'
    AND "order_number" ~ '^SO-[0-9]{4}-[0-9]+.*$'
    AND COALESCE(substring("order_number" from '^SO-[0-9]{4}-[0-9]+(.*)$'), '') !~ '^-[0-9]'
), unique_candidates AS (
  SELECT *
  FROM (
    SELECT
      candidates.*,
      COUNT(*) OVER (
        PARTITION BY "organization_id", "next_order_number"
      ) AS "target_count"
    FROM candidates
  ) counted
  WHERE "target_count" = 1
), safe_candidates AS (
  SELECT unique_candidates.*
  FROM unique_candidates
  WHERE NOT EXISTS (
    SELECT 1
    FROM "sales"."sales_orders" existing
    WHERE existing."organization_id" = unique_candidates."organization_id"
      AND existing."order_number" = unique_candidates."next_order_number"
      AND existing."id" <> unique_candidates."id"
  )
)
UPDATE "sales"."sales_orders" target
SET "order_number" = safe_candidates."next_order_number",
    "updated_at" = now()
FROM safe_candidates
WHERE target."id" = safe_candidates."id";--> statement-breakpoint

UPDATE "manufacturing"."manufacturing_orders" target
SET "sales_order_number" = source."order_number",
    "updated_at" = now()
FROM "sales"."sales_orders" source
WHERE target."sales_order_id" = source."id"
  AND target."deleted_at" IS NULL
  AND target."sales_order_number" IS DISTINCT FROM source."order_number";--> statement-breakpoint

WITH candidates AS (
  SELECT
    "id",
    "organization_id",
    'MO-' ||
      COALESCE(NULLIF(ltrim(substring("order_number" from '^MO-[0-9]{4}-([0-9]+)'), '0'), ''), '0') ||
      COALESCE(substring("order_number" from '^MO-[0-9]{4}-[0-9]+(.*)$'), '') AS "next_order_number"
  FROM "manufacturing"."manufacturing_orders"
  WHERE "deleted_at" IS NULL
    AND "status" <> 'done'
    AND "order_number" ~ '^MO-[0-9]{4}-[0-9]+.*$'
    AND COALESCE(substring("order_number" from '^MO-[0-9]{4}-[0-9]+(.*)$'), '') !~ '^-[0-9]'
), unique_candidates AS (
  SELECT *
  FROM (
    SELECT
      candidates.*,
      COUNT(*) OVER (
        PARTITION BY "organization_id", "next_order_number"
      ) AS "target_count"
    FROM candidates
  ) counted
  WHERE "target_count" = 1
), safe_candidates AS (
  SELECT unique_candidates.*
  FROM unique_candidates
  WHERE NOT EXISTS (
    SELECT 1
    FROM "manufacturing"."manufacturing_orders" existing
    WHERE existing."organization_id" = unique_candidates."organization_id"
      AND existing."order_number" = unique_candidates."next_order_number"
      AND existing."id" <> unique_candidates."id"
  )
)
UPDATE "manufacturing"."manufacturing_orders" target
SET "order_number" = safe_candidates."next_order_number",
    "updated_at" = now()
FROM safe_candidates
WHERE target."id" = safe_candidates."id";
