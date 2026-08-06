ALTER TABLE "manufacturing"."manufacturing_order_ingredients" ADD COLUMN IF NOT EXISTS "bom_revision_component_id" uuid;--> statement-breakpoint
UPDATE "manufacturing"."manufacturing_order_ingredients" AS ingredient
SET "bom_revision_component_id" = component.id
FROM "manufacturing"."manufacturing_orders" AS manufacturing_order
JOIN "inventory"."bom_revision_components" AS component
  ON component.bom_revision_id = manufacturing_order.bom_revision_id
WHERE ingredient.manufacturing_order_id = manufacturing_order.id
  AND ingredient.sort_order = component.sort_order
  AND ingredient.bom_revision_component_id IS NULL;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients" DROP CONSTRAINT IF EXISTS "manufacturing_order_ingredients_bom_revision_component_id_bom_revision_components_id_fk";--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients" ADD CONSTRAINT "manufacturing_order_ingredients_bom_revision_component_id_bom_revision_components_id_fk" FOREIGN KEY ("bom_revision_component_id") REFERENCES "inventory"."bom_revision_components"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manufacturing_order_ingredients_bom_component_id_idx" ON "manufacturing"."manufacturing_order_ingredients" USING btree ("bom_revision_component_id");
