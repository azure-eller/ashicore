ALTER TABLE "inventory"."unit_definitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "unit_definitions_org_isolation" ON "inventory"."unit_definitions" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "items_org_isolation" ON "inventory"."items" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true));