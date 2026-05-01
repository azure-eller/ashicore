CREATE TABLE IF NOT EXISTS "inventory"."bom_revision_component_alternates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bom_revision_component_id" uuid NOT NULL,
	"alternate_item_id" uuid NOT NULL,
	"alternate_item_name" varchar(255) NOT NULL,
	"alternate_item_sku" varchar(50),
	"alternate_item_type" varchar(20) NOT NULL,
	"unit_name" varchar(50) NOT NULL,
	"quantity_factor" numeric(12, 4) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bom_revision_component_alternates_quantity_factor_check" CHECK (quantity_factor > 0)
);
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_component_alternates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint ALTER TABLE "inventory"."bom_revision_component_alternates" DROP CONSTRAINT IF EXISTS "bom_revision_component_alternates_bom_revision_component_id_bom_revision_components_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_component_alternates" ADD CONSTRAINT "bom_revision_component_alternates_bom_revision_component_id_bom_revision_components_id_fk" FOREIGN KEY ("bom_revision_component_id") REFERENCES "inventory"."bom_revision_components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."bom_revision_component_alternates" DROP CONSTRAINT IF EXISTS "bom_revision_component_alternates_alternate_item_id_items_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_component_alternates" ADD CONSTRAINT "bom_revision_component_alternates_alternate_item_id_items_id_fk" FOREIGN KEY ("alternate_item_id") REFERENCES "inventory"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bom_revision_component_alternates_component_id_idx" ON "inventory"."bom_revision_component_alternates" USING btree ("bom_revision_component_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bom_revision_component_alternates_item_id_idx" ON "inventory"."bom_revision_component_alternates" USING btree ("alternate_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bom_revision_component_alternates_component_item_uidx" ON "inventory"."bom_revision_component_alternates" USING btree ("bom_revision_component_id","alternate_item_id");--> statement-breakpoint DROP POLICY IF EXISTS "bom_revision_component_alternates_org_isolation" ON "inventory"."bom_revision_component_alternates";--> statement-breakpoint
CREATE POLICY "bom_revision_component_alternates_org_isolation" ON "inventory"."bom_revision_component_alternates" AS PERMISSIVE FOR ALL TO public USING (bom_revision_component_id IN (
          SELECT c.id
          FROM inventory.bom_revision_components c
          INNER JOIN inventory.bom_revisions r
            ON r.id = c.bom_revision_id
          WHERE r.organization_id = current_setting('app.current_org_id', true)
        )) WITH CHECK (bom_revision_component_id IN (
          SELECT c.id
          FROM inventory.bom_revision_components c
          INNER JOIN inventory.bom_revisions r
            ON r.id = c.bom_revision_id
          WHERE r.organization_id = current_setting('app.current_org_id', true)
        ));--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_component_alternates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT USAGE ON SCHEMA "inventory" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."bom_revision_component_alternates" TO app_user;
