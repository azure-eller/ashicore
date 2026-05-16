ALTER TABLE "inventory"."items"
  ADD COLUMN IF NOT EXISTS "typical_batch_size" numeric(12, 4);
--> statement-breakpoint
ALTER TABLE "inventory"."items"
  ADD COLUMN IF NOT EXISTS "typical_group_size" numeric(12, 4);
--> statement-breakpoint
UPDATE "inventory"."items"
SET "typical_batch_size" = "expected_batch_yield"
WHERE "manufacturing_mode" = 'batch'
  AND "expected_batch_yield" IS NOT NULL
  AND "expected_batch_yield" > 0
  AND "typical_batch_size" IS NULL;
--> statement-breakpoint
ALTER TABLE "inventory"."items"
  DROP CONSTRAINT IF EXISTS "items_typical_batch_size_positive";
--> statement-breakpoint
ALTER TABLE "inventory"."items"
  ADD CONSTRAINT "items_typical_batch_size_positive"
  CHECK ("typical_batch_size" IS NULL OR "typical_batch_size" > 0);
--> statement-breakpoint
ALTER TABLE "inventory"."items"
  DROP CONSTRAINT IF EXISTS "items_typical_group_size_positive";
--> statement-breakpoint
ALTER TABLE "inventory"."items"
  ADD CONSTRAINT "items_typical_group_size_positive"
  CHECK ("typical_group_size" IS NULL OR "typical_group_size" > 0);
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  ADD COLUMN IF NOT EXISTS "consumption_mode" varchar(32) DEFAULT 'per_output_unit' NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  ADD COLUMN IF NOT EXISTS "basis_output_quantity" numeric(12, 4);
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  ADD COLUMN IF NOT EXISTS "batch_scaling_mode" varchar(32);
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  ADD COLUMN IF NOT EXISTS "group_remainder_policy" varchar(32);
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  ADD COLUMN IF NOT EXISTS "scaling_review_recommended" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "inventory"."bom_revision_components" AS component
SET
  "consumption_mode" = 'per_batch',
  "basis_output_quantity" = product."expected_batch_yield",
  "batch_scaling_mode" = 'full_batches_only',
  "group_remainder_policy" = NULL,
  "scaling_review_recommended" = true
FROM "inventory"."bom_revisions" AS revision
INNER JOIN "inventory"."items" AS product
  ON product."id" = revision."product_id"
WHERE component."bom_revision_id" = revision."id"
  AND product."manufacturing_mode" = 'batch'
  AND product."expected_batch_yield" IS NOT NULL
  AND product."expected_batch_yield" > 0
  AND component."consumption_mode" = 'per_output_unit';
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  DROP CONSTRAINT IF EXISTS "bom_revision_components_consumption_mode_check";
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  ADD CONSTRAINT "bom_revision_components_consumption_mode_check"
  CHECK ("consumption_mode" IN ('per_output_unit', 'per_batch', 'per_group'));
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  DROP CONSTRAINT IF EXISTS "bom_revision_components_batch_scaling_mode_check";
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  ADD CONSTRAINT "bom_revision_components_batch_scaling_mode_check"
  CHECK ("batch_scaling_mode" IS NULL OR "batch_scaling_mode" IN ('proportional', 'full_batches_only'));
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  DROP CONSTRAINT IF EXISTS "bom_revision_components_group_remainder_policy_check";
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  ADD CONSTRAINT "bom_revision_components_group_remainder_policy_check"
  CHECK ("group_remainder_policy" IS NULL OR "group_remainder_policy" IN ('ask', 'leave_loose', 'create_partial_group'));
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  DROP CONSTRAINT IF EXISTS "bom_revision_components_basis_output_quantity_check";
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  ADD CONSTRAINT "bom_revision_components_basis_output_quantity_check"
  CHECK (
    (
      "consumption_mode" = 'per_output_unit'
      AND "basis_output_quantity" IS NULL
    ) OR (
      "consumption_mode" IN ('per_batch', 'per_group')
      AND "basis_output_quantity" IS NOT NULL
      AND "basis_output_quantity" > 0
    )
  );
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  DROP CONSTRAINT IF EXISTS "bom_revision_components_batch_fields_check";
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  ADD CONSTRAINT "bom_revision_components_batch_fields_check"
  CHECK (
    (
      "consumption_mode" = 'per_batch'
      AND "batch_scaling_mode" IS NOT NULL
      AND "group_remainder_policy" IS NULL
    ) OR "consumption_mode" <> 'per_batch'
  );
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  DROP CONSTRAINT IF EXISTS "bom_revision_components_group_fields_check";
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  ADD CONSTRAINT "bom_revision_components_group_fields_check"
  CHECK (
    (
      "consumption_mode" = 'per_group'
      AND "group_remainder_policy" IS NOT NULL
      AND "batch_scaling_mode" IS NULL
    ) OR "consumption_mode" <> 'per_group'
  );
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  ADD COLUMN IF NOT EXISTS "consumption_mode" varchar(32) DEFAULT 'per_output_unit' NOT NULL;
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  ADD COLUMN IF NOT EXISTS "basis_output_quantity" numeric(12, 4);
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  ADD COLUMN IF NOT EXISTS "batch_scaling_mode" varchar(32);
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  ADD COLUMN IF NOT EXISTS "group_remainder_policy" varchar(32);
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  ADD COLUMN IF NOT EXISTS "chosen_group_remainder_handling" varchar(32);
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  ADD COLUMN IF NOT EXISTS "calculated_batch_count" numeric(12, 4);
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  ADD COLUMN IF NOT EXISTS "calculated_group_count" numeric(12, 4);
--> statement-breakpoint
UPDATE "manufacturing"."manufacturing_order_ingredients" AS ingredient
SET
  "consumption_mode" = 'per_batch',
  "basis_output_quantity" = mo."expected_batch_yield",
  "batch_scaling_mode" = 'full_batches_only',
  "group_remainder_policy" = NULL,
  "chosen_group_remainder_handling" = NULL,
  "calculated_batch_count" = CASE
    WHEN ingredient."manufacturing_order_batch_id" IS NULL
      AND mo."number_of_batches" IS NOT NULL
    THEN mo."number_of_batches"::numeric
    ELSE NULL
  END
FROM "manufacturing"."manufacturing_orders" AS mo
WHERE ingredient."manufacturing_order_id" = mo."id"
  AND mo."manufacturing_mode" = 'batch'
  AND mo."expected_batch_yield" IS NOT NULL
  AND mo."expected_batch_yield" > 0
  AND ingredient."consumption_mode" = 'per_output_unit';
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  DROP CONSTRAINT IF EXISTS "manufacturing_order_ingredients_consumption_mode_check";
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  ADD CONSTRAINT "manufacturing_order_ingredients_consumption_mode_check"
  CHECK ("consumption_mode" IN ('per_output_unit', 'per_batch', 'per_group'));
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  DROP CONSTRAINT IF EXISTS "manufacturing_order_ingredients_batch_scaling_mode_check";
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  ADD CONSTRAINT "manufacturing_order_ingredients_batch_scaling_mode_check"
  CHECK ("batch_scaling_mode" IS NULL OR "batch_scaling_mode" IN ('proportional', 'full_batches_only'));
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  DROP CONSTRAINT IF EXISTS "manufacturing_order_ingredients_group_remainder_policy_check";
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  ADD CONSTRAINT "manufacturing_order_ingredients_group_remainder_policy_check"
  CHECK ("group_remainder_policy" IS NULL OR "group_remainder_policy" IN ('ask', 'leave_loose', 'create_partial_group'));
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  DROP CONSTRAINT IF EXISTS "manufacturing_order_ingredients_group_handling_check";
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  ADD CONSTRAINT "manufacturing_order_ingredients_group_handling_check"
  CHECK ("chosen_group_remainder_handling" IS NULL OR "chosen_group_remainder_handling" IN ('leave_loose', 'create_partial_group'));
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  DROP CONSTRAINT IF EXISTS "manufacturing_order_ingredients_basis_output_quantity_check";
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  ADD CONSTRAINT "manufacturing_order_ingredients_basis_output_quantity_check"
  CHECK ("basis_output_quantity" IS NULL OR "basis_output_quantity" > 0);
