ALTER TABLE "inventory"."bom_revisions"
  ADD COLUMN IF NOT EXISTS "output_quantity" numeric(12, 4) DEFAULT '1' NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  ADD COLUMN IF NOT EXISTS "every_quantity" numeric(12, 4) DEFAULT '1' NOT NULL;
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  ADD COLUMN IF NOT EXISTS "bom_output_quantity" numeric(12, 4);
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  ADD COLUMN IF NOT EXISTS "every_quantity" numeric(12, 4) DEFAULT '1' NOT NULL;
--> statement-breakpoint
WITH revision_basis AS (
  SELECT
    bom_revision_id,
    MIN(basis_output_quantity) AS basis_output_quantity
  FROM "inventory"."bom_revision_components"
  WHERE basis_output_quantity IS NOT NULL
    AND basis_output_quantity > 0
    AND consumption_mode IN ('per_batch', 'per_group')
  GROUP BY bom_revision_id
  HAVING COUNT(DISTINCT basis_output_quantity) = 1
)
UPDATE "inventory"."bom_revisions" revisions
SET output_quantity = revision_basis.basis_output_quantity
FROM revision_basis
WHERE revisions.id = revision_basis.bom_revision_id;
--> statement-breakpoint
UPDATE "inventory"."bom_revision_components" components
SET quantity = components.quantity * revisions.output_quantity
FROM "inventory"."bom_revisions" revisions
WHERE components.bom_revision_id = revisions.id
  AND components.consumption_mode = 'per_output_unit'
  AND revisions.output_quantity <> 1;
--> statement-breakpoint
UPDATE "inventory"."bom_revision_components" components
SET every_quantity = CASE
  WHEN components.consumption_mode IN ('per_batch', 'per_group')
    AND components.basis_output_quantity IS NOT NULL
    AND components.basis_output_quantity > 0
    THEN components.basis_output_quantity
  ELSE revisions.output_quantity
END
FROM "inventory"."bom_revisions" revisions
WHERE components.bom_revision_id = revisions.id;
--> statement-breakpoint
UPDATE "manufacturing"."manufacturing_order_ingredients" ingredients
SET every_quantity = CASE
  WHEN ingredients.consumption_mode IN ('per_batch', 'per_group')
    AND ingredients.basis_output_quantity IS NOT NULL
    AND ingredients.basis_output_quantity > 0
    THEN ingredients.basis_output_quantity
  ELSE '1'
END
WHERE ingredients.every_quantity = 1;
--> statement-breakpoint
UPDATE "manufacturing"."manufacturing_order_ingredients" ingredients
SET bom_output_quantity = revisions.output_quantity
FROM "manufacturing"."manufacturing_orders" orders
INNER JOIN "inventory"."bom_revisions" revisions
  ON revisions.id = orders.bom_revision_id
WHERE ingredients.manufacturing_order_id = orders.id
  AND ingredients.bom_output_quantity IS NULL;
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  DROP CONSTRAINT IF EXISTS "bom_revision_components_every_quantity_check";
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components"
  ADD CONSTRAINT "bom_revision_components_every_quantity_check"
  CHECK ("every_quantity" > 0);
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revisions"
  DROP CONSTRAINT IF EXISTS "bom_revisions_output_quantity_check";
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revisions"
  ADD CONSTRAINT "bom_revisions_output_quantity_check"
  CHECK ("output_quantity" > 0);
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  DROP CONSTRAINT IF EXISTS "manufacturing_order_ingredients_every_quantity_check";
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients"
  ADD CONSTRAINT "manufacturing_order_ingredients_every_quantity_check"
  CHECK ("every_quantity" > 0);
