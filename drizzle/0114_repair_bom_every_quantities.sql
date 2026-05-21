WITH single_component_basis AS (
  SELECT
    bom_revision_id,
    MIN(basis_output_quantity) AS basis_output_quantity
  FROM "inventory"."bom_revision_components"
  WHERE basis_output_quantity IS NOT NULL
    AND basis_output_quantity > 0
    AND consumption_mode IN ('per_batch', 'per_group')
  GROUP BY bom_revision_id
  HAVING COUNT(DISTINCT basis_output_quantity) = 1
),
revision_recipe_basis AS (
  SELECT
    revisions.id AS bom_revision_id,
    CASE
      WHEN products.expected_batch_yield IS NOT NULL
        AND products.expected_batch_yield > 0
        THEN products.expected_batch_yield
      WHEN products.typical_batch_size IS NOT NULL
        AND products.typical_batch_size > 0
        THEN products.typical_batch_size
      WHEN products.typical_group_size IS NOT NULL
        AND products.typical_group_size > 0
        THEN products.typical_group_size
      WHEN single_component_basis.basis_output_quantity IS NOT NULL
        AND single_component_basis.basis_output_quantity > 0
        THEN single_component_basis.basis_output_quantity
      ELSE revisions.output_quantity
    END AS output_quantity
  FROM "inventory"."bom_revisions" revisions
  INNER JOIN "inventory"."items" products
    ON products.id = revisions.product_id
  LEFT JOIN single_component_basis
    ON single_component_basis.bom_revision_id = revisions.id
)
UPDATE "inventory"."bom_revisions" revisions
SET output_quantity = revision_recipe_basis.output_quantity
FROM revision_recipe_basis
WHERE revisions.id = revision_recipe_basis.bom_revision_id
  AND revision_recipe_basis.output_quantity IS NOT NULL
  AND revision_recipe_basis.output_quantity > 0
  AND revisions.output_quantity <> revision_recipe_basis.output_quantity;
--> statement-breakpoint
UPDATE "inventory"."bom_revision_components" components
SET quantity = components.quantity / revisions.output_quantity
FROM "inventory"."bom_revisions" revisions
INNER JOIN "inventory"."items" products
  ON products.id = revisions.product_id
WHERE components.bom_revision_id = revisions.id
  AND products.category = 'Soil Bags'
  AND components.consumption_mode = 'per_output_unit'
  AND revisions.output_quantity > 1
  AND components.every_quantity = revisions.output_quantity;
--> statement-breakpoint
UPDATE "inventory"."bom_revision_components" components
SET every_quantity = CASE
  WHEN components.consumption_mode IN ('per_batch', 'per_group')
    AND components.basis_output_quantity IS NOT NULL
    AND components.basis_output_quantity > 0
    THEN components.basis_output_quantity
  WHEN components.consumption_mode = 'per_output_unit'
    AND products.category IN ('Soil Bags', 'Soil Totes')
    THEN '1'
  ELSE revisions.output_quantity
END
FROM "inventory"."bom_revisions" revisions
INNER JOIN "inventory"."items" products
  ON products.id = revisions.product_id
WHERE components.bom_revision_id = revisions.id;
