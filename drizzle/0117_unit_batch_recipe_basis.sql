ALTER TABLE "inventory"."bom_revisions"
  ADD COLUMN IF NOT EXISTS "recipe_basis" varchar(16) DEFAULT 'unit' NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "inventory"."bom_revisions" revision
    INNER JOIN "inventory"."items" product
      ON product."id" = revision."product_id"
    WHERE product."manufacturing_mode" = 'batch'
      AND (product."expected_batch_yield" IS NULL OR product."expected_batch_yield" <= 0)
  ) THEN
    RAISE EXCEPTION 'Cannot migrate batch BOM revisions without positive expected_batch_yield.';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "inventory"."bom_revision_components" component
    INNER JOIN "inventory"."bom_revisions" revision
      ON revision."id" = component."bom_revision_id"
    WHERE COALESCE(
      NULLIF(component."every_quantity", 0),
      NULLIF(component."basis_output_quantity", 0),
      NULLIF(revision."output_quantity", 0),
      1
    ) <= 0
  ) THEN
    RAISE EXCEPTION 'Cannot migrate BOM rows with non-positive recipe quantity basis.';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "manufacturing"."manufacturing_order_ingredients" ingredient
    INNER JOIN "manufacturing"."manufacturing_orders" mo
      ON mo."id" = ingredient."manufacturing_order_id"
    WHERE mo."status" = 'open'
      AND mo."deleted_at" IS NULL
      AND (
        COALESCE(
          NULLIF(ingredient."every_quantity", 0),
          NULLIF(ingredient."basis_output_quantity", 0),
          NULLIF(mo."expected_batch_yield", 0),
          1
        ) <= 0
        OR (
          mo."manufacturing_mode" = 'batch'
          AND (mo."expected_batch_yield" IS NULL OR mo."expected_batch_yield" <= 0)
        )
      )
  ) THEN
    RAISE EXCEPTION 'Cannot migrate manufacturing ingredient rows with non-positive recipe quantity basis.';
  END IF;
END $$;
--> statement-breakpoint
UPDATE "inventory"."bom_revisions" revision
SET
  "recipe_basis" = CASE
    WHEN product."manufacturing_mode" = 'batch' THEN 'batch'
    ELSE 'unit'
  END,
  "output_quantity" = CASE
    WHEN product."manufacturing_mode" = 'batch' THEN product."expected_batch_yield"
    ELSE '1'
  END
FROM "inventory"."items" product
WHERE product."id" = revision."product_id";
--> statement-breakpoint
UPDATE "inventory"."bom_revision_components" component
SET "quantity" = CASE
  WHEN revision."recipe_basis" = 'batch'
    AND component."consumption_mode" = 'per_group'
    THEN component."quantity" * CEIL(revision."output_quantity" / COALESCE(
      NULLIF(component."every_quantity", 0),
      NULLIF(component."basis_output_quantity", 0),
      NULLIF(revision."output_quantity", 0),
      1
    ))
  ELSE component."quantity" * revision."output_quantity" / COALESCE(
    NULLIF(component."every_quantity", 0),
    NULLIF(component."basis_output_quantity", 0),
    NULLIF(revision."output_quantity", 0),
    1
  )
END
FROM "inventory"."bom_revisions" revision
WHERE revision."id" = component."bom_revision_id";
--> statement-breakpoint
UPDATE "manufacturing"."manufacturing_order_ingredients" ingredient
SET "quantity_per_unit" = CASE
  WHEN mo."manufacturing_mode" = 'batch'
    AND ingredient."consumption_mode" = 'per_group'
    THEN ingredient."quantity_per_unit" * CEIL(mo."expected_batch_yield" / COALESCE(
      NULLIF(ingredient."every_quantity", 0),
      NULLIF(ingredient."basis_output_quantity", 0),
      NULLIF(mo."expected_batch_yield", 0),
      1
    ))
  ELSE ingredient."quantity_per_unit" * CASE
    WHEN mo."manufacturing_mode" = 'batch' THEN mo."expected_batch_yield"
    ELSE '1'
  END / COALESCE(
    NULLIF(ingredient."every_quantity", 0),
    NULLIF(ingredient."basis_output_quantity", 0),
    NULLIF(mo."expected_batch_yield", 0),
    1
  )
END
FROM "manufacturing"."manufacturing_orders" mo
WHERE mo."id" = ingredient."manufacturing_order_id"
  AND mo."status" = 'open'
  AND mo."deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revisions"
  DROP CONSTRAINT IF EXISTS "bom_revisions_recipe_basis_check";
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revisions"
  ADD CONSTRAINT "bom_revisions_recipe_basis_check"
  CHECK ("recipe_basis" IN ('unit', 'batch'));
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revisions"
  DROP CONSTRAINT IF EXISTS "bom_revisions_output_quantity_check";
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revisions"
  ADD CONSTRAINT "bom_revisions_output_quantity_check"
  CHECK ("output_quantity" > 0);
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  DROP CONSTRAINT IF EXISTS "bom_revision_components_every_quantity_check";
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  DROP CONSTRAINT IF EXISTS "bom_revision_components_consumption_mode_check";
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  DROP CONSTRAINT IF EXISTS "bom_revision_components_batch_scaling_mode_check";
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  DROP CONSTRAINT IF EXISTS "bom_revision_components_group_remainder_policy_check";
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  DROP CONSTRAINT IF EXISTS "bom_revision_components_basis_output_quantity_check";
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  DROP CONSTRAINT IF EXISTS "bom_revision_components_batch_fields_check";
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  DROP CONSTRAINT IF EXISTS "bom_revision_components_group_fields_check";
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  DROP CONSTRAINT IF EXISTS "manufacturing_order_ingredients_every_quantity_check";
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  DROP CONSTRAINT IF EXISTS "manufacturing_order_ingredients_consumption_mode_check";
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  DROP CONSTRAINT IF EXISTS "manufacturing_order_ingredients_batch_scaling_mode_check";
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  DROP CONSTRAINT IF EXISTS "manufacturing_order_ingredients_group_remainder_policy_check";
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  DROP CONSTRAINT IF EXISTS "manufacturing_order_ingredients_group_handling_check";
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  DROP CONSTRAINT IF EXISTS "manufacturing_order_ingredients_basis_output_quantity_check";
--> statement-breakpoint
ALTER TABLE "inventory"."items"
  DROP CONSTRAINT IF EXISTS "items_typical_group_size_positive";
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  DROP COLUMN IF EXISTS "every_quantity",
  DROP COLUMN IF EXISTS "consumption_mode",
  DROP COLUMN IF EXISTS "basis_output_quantity",
  DROP COLUMN IF EXISTS "batch_scaling_mode",
  DROP COLUMN IF EXISTS "group_remainder_policy",
  DROP COLUMN IF EXISTS "scaling_review_recommended";
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  DROP COLUMN IF EXISTS "bom_output_quantity",
  DROP COLUMN IF EXISTS "every_quantity",
  DROP COLUMN IF EXISTS "consumption_mode",
  DROP COLUMN IF EXISTS "basis_output_quantity",
  DROP COLUMN IF EXISTS "batch_scaling_mode",
  DROP COLUMN IF EXISTS "group_remainder_policy",
  DROP COLUMN IF EXISTS "chosen_group_remainder_handling",
  DROP COLUMN IF EXISTS "calculated_batch_count",
  DROP COLUMN IF EXISTS "calculated_group_count";
--> statement-breakpoint
ALTER TABLE "inventory"."items"
  DROP COLUMN IF EXISTS "typical_group_size";
