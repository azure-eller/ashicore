CREATE TABLE IF NOT EXISTS "inventory"."bom_revision_component_constraints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bom_revision_component_id" uuid NOT NULL,
	"constraint_type" varchar(64) NOT NULL,
	"config" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bom_revision_component_constraints_type_check" CHECK (constraint_type IN ('lot_age_min_days')),
	CONSTRAINT "bom_revision_component_constraints_config_check" CHECK (constraint_type <> 'lot_age_min_days'
          OR (
            config->>'basis' = 'received_at'
            AND (config->>'days') ~ '^[1-9][0-9]*$'
          ))
);
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_component_constraints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_component_constraints" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "manufacturing"."manufacturing_order_ingredient_constraints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manufacturing_order_ingredient_id" uuid NOT NULL,
	"constraint_type" varchar(64) NOT NULL,
	"config" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "manufacturing_order_ingredient_constraints_type_check" CHECK (constraint_type IN ('lot_age_min_days')),
	CONSTRAINT "manufacturing_order_ingredient_constraints_config_check" CHECK (constraint_type <> 'lot_age_min_days'
          OR (
            config->>'basis' = 'received_at'
            AND (config->>'days') ~ '^[1-9][0-9]*$'
          ))
);
--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredient_constraints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredient_constraints" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_pick_allocations" ADD COLUMN IF NOT EXISTS "requirement_override_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_pick_allocations" ADD COLUMN IF NOT EXISTS "requirement_override_confirmed_by" text;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_pick_allocations" ADD COLUMN IF NOT EXISTS "requirement_override_confirmed_at" timestamp;--> statement-breakpoint ALTER TABLE "inventory"."bom_revision_component_constraints" DROP CONSTRAINT IF EXISTS "bom_revision_component_constraints_bom_revision_component_id_bom_revision_components_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_component_constraints" ADD CONSTRAINT "bom_revision_component_constraints_bom_revision_component_id_bom_revision_components_id_fk" FOREIGN KEY ("bom_revision_component_id") REFERENCES "inventory"."bom_revision_components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint ALTER TABLE "manufacturing"."manufacturing_order_ingredient_constraints" DROP CONSTRAINT IF EXISTS "manufacturing_order_ingredient_constraints_manufacturing_order_ingredient_id_manufacturing_order_ingredients_id_fk";--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredient_constraints" ADD CONSTRAINT "manufacturing_order_ingredient_constraints_manufacturing_order_ingredient_id_manufacturing_order_ingredients_id_fk" FOREIGN KEY ("manufacturing_order_ingredient_id") REFERENCES "manufacturing"."manufacturing_order_ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bom_revision_component_constraints_component_id_idx" ON "inventory"."bom_revision_component_constraints" USING btree ("bom_revision_component_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bom_revision_component_constraints_component_type_uidx" ON "inventory"."bom_revision_component_constraints" USING btree ("bom_revision_component_id","constraint_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manufacturing_order_ingredient_constraints_ingredient_id_idx" ON "manufacturing"."manufacturing_order_ingredient_constraints" USING btree ("manufacturing_order_ingredient_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "manufacturing_order_ingredient_constraints_type_uidx" ON "manufacturing"."manufacturing_order_ingredient_constraints" USING btree ("manufacturing_order_ingredient_id","constraint_type");--> statement-breakpoint DROP POLICY IF EXISTS "bom_revision_component_constraints_org_isolation" ON "inventory"."bom_revision_component_constraints";--> statement-breakpoint
CREATE POLICY "bom_revision_component_constraints_org_isolation" ON "inventory"."bom_revision_component_constraints" AS PERMISSIVE FOR ALL TO public USING (bom_revision_component_id IN (
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
        ));--> statement-breakpoint DROP POLICY IF EXISTS "manufacturing_order_ingredient_constraints_org_isolation" ON "manufacturing"."manufacturing_order_ingredient_constraints";--> statement-breakpoint
CREATE POLICY "manufacturing_order_ingredient_constraints_org_isolation" ON "manufacturing"."manufacturing_order_ingredient_constraints" AS PERMISSIVE FOR ALL TO public USING (manufacturing_order_ingredient_id IN (
          SELECT i.id
          FROM manufacturing.manufacturing_order_ingredients i
          INNER JOIN manufacturing.manufacturing_orders o
            ON o.id = i.manufacturing_order_id
          WHERE o.organization_id = current_setting('app.current_org_id', true)
        )) WITH CHECK (manufacturing_order_ingredient_id IN (
          SELECT i.id
          FROM manufacturing.manufacturing_order_ingredients i
          INNER JOIN manufacturing.manufacturing_orders o
            ON o.id = i.manufacturing_order_id
          WHERE o.organization_id = current_setting('app.current_org_id', true)
        ));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."bom_revision_component_constraints" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manufacturing"."manufacturing_order_ingredient_constraints" TO app_user;
