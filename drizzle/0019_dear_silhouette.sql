DELETE FROM "inventory"."bom_components" WHERE "quantity" IS NULL;--> statement-breakpoint
ALTER TABLE "inventory"."bom_components" ALTER COLUMN "quantity" SET NOT NULL;--> statement-breakpoint
ALTER POLICY "bom_components_org_isolation" ON "inventory"."bom_components" TO public USING (
          item_id IN (
            SELECT id
            FROM inventory.items
            WHERE organization_id = current_setting('app.current_org_id', true)
          )
          AND component_id IN (
            SELECT id
            FROM inventory.items
            WHERE organization_id = current_setting('app.current_org_id', true)
          )
        ) WITH CHECK (
          item_id IN (
            SELECT id
            FROM inventory.items
            WHERE organization_id = current_setting('app.current_org_id', true)
          )
          AND component_id IN (
            SELECT id
            FROM inventory.items
            WHERE organization_id = current_setting('app.current_org_id', true)
          )
        );
