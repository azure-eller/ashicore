UPDATE "settings"."tax_rates" AS legacy_purchase
SET
  "name" = 'Tax On Purchase',
  "rate_percent" = '0',
  "updated_at" = now()
WHERE
  legacy_purchase."deleted_at" IS NULL
  AND legacy_purchase."name" = 'Tax on Purchase'
  AND NOT EXISTS (
    SELECT 1
    FROM "settings"."tax_rates" AS canonical_purchase
    WHERE
      canonical_purchase."organization_id" = legacy_purchase."organization_id"
      AND canonical_purchase."name" = 'Tax On Purchase'
      AND canonical_purchase."deleted_at" IS NULL
  );
--> statement-breakpoint
INSERT INTO "settings"."tax_rates" (
  "organization_id",
  "name",
  "rate_percent"
)
SELECT
  org."id",
  'Tax Exempt',
  '0'
FROM "system"."organization" AS org
WHERE NOT EXISTS (
  SELECT 1
  FROM "settings"."tax_rates" AS tax_rate
  WHERE
    tax_rate."organization_id" = org."id"
    AND tax_rate."name" = 'Tax Exempt'
    AND tax_rate."deleted_at" IS NULL
);
--> statement-breakpoint
INSERT INTO "settings"."tax_rates" (
  "organization_id",
  "name",
  "rate_percent"
)
SELECT
  org."id",
  'Tax On Purchase',
  '0'
FROM "system"."organization" AS org
WHERE NOT EXISTS (
  SELECT 1
  FROM "settings"."tax_rates" AS tax_rate
  WHERE
    tax_rate."organization_id" = org."id"
    AND tax_rate."name" = 'Tax On Purchase'
    AND tax_rate."deleted_at" IS NULL
);
--> statement-breakpoint
INSERT INTO "settings"."organization_tax_settings" (
  "organization_id",
  "default_sales_tax_rate_id",
  "default_purchase_tax_rate_id"
)
SELECT
  org."id",
  sales_tax_rate."id",
  purchase_tax_rate."id"
FROM "system"."organization" AS org
JOIN "settings"."tax_rates" AS sales_tax_rate
  ON sales_tax_rate."organization_id" = org."id"
  AND sales_tax_rate."name" = 'Tax Exempt'
  AND sales_tax_rate."deleted_at" IS NULL
JOIN "settings"."tax_rates" AS purchase_tax_rate
  ON purchase_tax_rate."organization_id" = org."id"
  AND purchase_tax_rate."name" = 'Tax On Purchase'
  AND purchase_tax_rate."deleted_at" IS NULL
ON CONFLICT ("organization_id") DO UPDATE SET
  "default_sales_tax_rate_id" = CASE
    WHEN
      "settings"."organization_tax_settings"."default_sales_tax_rate_id" IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM "settings"."tax_rates" AS current_sales_default
        WHERE
          current_sales_default."id" = "settings"."organization_tax_settings"."default_sales_tax_rate_id"
          AND current_sales_default."organization_id" = "settings"."organization_tax_settings"."organization_id"
          AND current_sales_default."deleted_at" IS NULL
      )
    THEN EXCLUDED."default_sales_tax_rate_id"
    ELSE "settings"."organization_tax_settings"."default_sales_tax_rate_id"
  END,
  "default_purchase_tax_rate_id" = CASE
    WHEN
      "settings"."organization_tax_settings"."default_purchase_tax_rate_id" IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM "settings"."tax_rates" AS current_purchase_default
        WHERE
          current_purchase_default."id" = "settings"."organization_tax_settings"."default_purchase_tax_rate_id"
          AND current_purchase_default."organization_id" = "settings"."organization_tax_settings"."organization_id"
          AND current_purchase_default."deleted_at" IS NULL
      )
    THEN EXCLUDED."default_purchase_tax_rate_id"
    ELSE "settings"."organization_tax_settings"."default_purchase_tax_rate_id"
  END,
  "updated_at" = now();
