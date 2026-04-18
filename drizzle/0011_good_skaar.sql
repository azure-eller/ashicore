ALTER TABLE "inventory"."bom_components" RENAME COLUMN "parent_item_id" TO "item_id";--> statement-breakpoint
ALTER TABLE "inventory"."bom_components" DROP CONSTRAINT "unique_bom_component";--> statement-breakpoint
ALTER TABLE "inventory"."bom_components" DROP CONSTRAINT "no_self_reference";--> statement-breakpoint
ALTER TABLE "inventory"."bom_components" DROP CONSTRAINT "bom_components_parent_item_id_items_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD COLUMN IF NOT EXISTS "bom_mode" varchar(20);--> statement-breakpoint ALTER TABLE "inventory"."bom_components" DROP CONSTRAINT IF EXISTS "bom_components_item_id_items_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."bom_components" ADD CONSTRAINT "bom_components_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "inventory"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory"."bom_components" DROP COLUMN IF EXISTS "uom";--> statement-breakpoint
ALTER TABLE "inventory"."bom_components" DROP COLUMN IF EXISTS "sort_order";--> statement-breakpoint ALTER TABLE "inventory"."bom_components" DROP CONSTRAINT IF EXISTS "unique_bom_component";--> statement-breakpoint
ALTER TABLE "inventory"."bom_components" ADD CONSTRAINT "unique_bom_component" UNIQUE("item_id","component_id");--> statement-breakpoint ALTER TABLE "inventory"."bom_components" DROP CONSTRAINT IF EXISTS "no_self_reference";--> statement-breakpoint
ALTER TABLE "inventory"."bom_components" ADD CONSTRAINT "no_self_reference" CHECK (item_id != component_id);--> statement-breakpoint
ALTER POLICY "bom_components_org_isolation" ON "inventory"."bom_components" TO public USING (item_id IN (SELECT id FROM inventory.items WHERE organization_id = current_setting('app.current_org_id', true))) WITH CHECK (item_id IN (SELECT id FROM inventory.items WHERE organization_id = current_setting('app.current_org_id', true)));