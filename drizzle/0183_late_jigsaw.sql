ALTER TABLE "inventory"."bom_revision_component_alternates" DROP CONSTRAINT "bom_revision_component_alternates_quantity_factor_check";--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_component_alternates" ALTER COLUMN "quantity_factor" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_component_alternates" ADD COLUMN IF NOT EXISTS "quantity" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients" ADD COLUMN IF NOT EXISTS "bom_revision_component_id" uuid;--> statement-breakpoint
UPDATE "manufacturing"."manufacturing_order_ingredients" AS ingredient
SET "bom_revision_component_id" = component.id
FROM "manufacturing"."manufacturing_orders" AS manufacturing_order
JOIN "inventory"."bom_revision_components" AS component
  ON component.bom_revision_id = manufacturing_order.bom_revision_id
WHERE ingredient.manufacturing_order_id = manufacturing_order.id
  AND component.component_id = ingredient.item_id
  AND ingredient.bom_revision_component_id IS NULL;--> statement-breakpoint
UPDATE "manufacturing"."manufacturing_order_ingredients" AS ingredient
SET "bom_revision_component_id" = (
  SELECT component.id
  FROM "inventory"."bom_revision_components" AS component
  JOIN "inventory"."bom_revision_component_alternates" AS alternate
    ON alternate.bom_revision_component_id = component.id
  JOIN "manufacturing"."manufacturing_orders" AS manufacturing_order
    ON manufacturing_order.id = ingredient.manufacturing_order_id
  WHERE component.bom_revision_id = manufacturing_order.bom_revision_id
    AND alternate.alternate_item_id = ingredient.item_id
)
WHERE ingredient.bom_revision_component_id IS NULL
  AND (
    SELECT count(*)
    FROM "inventory"."bom_revision_components" AS component
    JOIN "inventory"."bom_revision_component_alternates" AS alternate
      ON alternate.bom_revision_component_id = component.id
    JOIN "manufacturing"."manufacturing_orders" AS manufacturing_order
      ON manufacturing_order.id = ingredient.manufacturing_order_id
    WHERE component.bom_revision_id = manufacturing_order.bom_revision_id
      AND alternate.alternate_item_id = ingredient.item_id
  ) = 1;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients" DROP CONSTRAINT IF EXISTS "manufacturing_order_ingredients_bom_revision_component_id_bom_revision_components_id_fk";--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients" ADD CONSTRAINT "manufacturing_order_ingredients_bom_revision_component_id_bom_revision_components_id_fk" FOREIGN KEY ("bom_revision_component_id") REFERENCES "inventory"."bom_revision_components"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manufacturing_order_ingredients_bom_component_id_idx" ON "manufacturing"."manufacturing_order_ingredients" USING btree ("bom_revision_component_id");--> statement-breakpoint ALTER TABLE "inventory"."bom_revision_component_alternates" DROP CONSTRAINT IF EXISTS "bom_revision_component_alternates_quantity_check";--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_component_alternates" ADD CONSTRAINT "bom_revision_component_alternates_quantity_check" CHECK (quantity IS NULL OR quantity > 0);--> statement-breakpoint ALTER TABLE "inventory"."bom_revision_component_alternates" DROP CONSTRAINT IF EXISTS "bom_revision_component_alternates_amount_present_check";--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_component_alternates" ADD CONSTRAINT "bom_revision_component_alternates_amount_present_check" CHECK (quantity IS NOT NULL OR quantity_factor IS NOT NULL);--> statement-breakpoint ALTER TABLE "inventory"."bom_revision_component_alternates" DROP CONSTRAINT IF EXISTS "bom_revision_component_alternates_quantity_factor_check";--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_component_alternates" ADD CONSTRAINT "bom_revision_component_alternates_quantity_factor_check" CHECK (quantity_factor IS NULL OR quantity_factor > 0);
