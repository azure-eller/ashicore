CREATE TABLE "inventory"."bom_revision_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bom_revision_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"component_name" varchar(255) NOT NULL,
	"component_sku" varchar(50),
	"component_item_type" varchar(20) NOT NULL,
	"unit_name" varchar(50) NOT NULL,
	"quantity" numeric(12, 4) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bom_revision_components_no_self_reference" CHECK (component_id IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory"."bom_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"note" varchar(500),
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory"."bom_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."bom_revisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_orders" ADD COLUMN "bom_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components" ADD CONSTRAINT "bom_revision_components_bom_revision_id_bom_revisions_id_fk" FOREIGN KEY ("bom_revision_id") REFERENCES "inventory"."bom_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory"."bom_revision_components" ADD CONSTRAINT "bom_revision_components_component_id_items_id_fk" FOREIGN KEY ("component_id") REFERENCES "inventory"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory"."bom_revisions" ADD CONSTRAINT "bom_revisions_product_id_items_id_fk" FOREIGN KEY ("product_id") REFERENCES "inventory"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bom_revision_components_revision_id_idx" ON "inventory"."bom_revision_components" USING btree ("bom_revision_id");--> statement-breakpoint
CREATE INDEX "bom_revision_components_component_id_idx" ON "inventory"."bom_revision_components" USING btree ("component_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bom_revision_components_revision_component_uidx" ON "inventory"."bom_revision_components" USING btree ("bom_revision_id","component_id");--> statement-breakpoint
CREATE INDEX "bom_revisions_org_id_idx" ON "inventory"."bom_revisions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "bom_revisions_product_id_idx" ON "inventory"."bom_revisions" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bom_revisions_product_revision_uidx" ON "inventory"."bom_revisions" USING btree ("product_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "bom_revisions_product_current_uidx" ON "inventory"."bom_revisions" USING btree ("product_id") WHERE "inventory"."bom_revisions"."is_current" = true;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_bom_revision_id_bom_revisions_id_fk" FOREIGN KEY ("bom_revision_id") REFERENCES "inventory"."bom_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manufacturing_orders_bom_revision_id_idx" ON "manufacturing"."manufacturing_orders" USING btree ("bom_revision_id");--> statement-breakpoint
CREATE POLICY "bom_revision_components_org_isolation" ON "inventory"."bom_revision_components" AS PERMISSIVE FOR ALL TO public USING (bom_revision_id IN (
          SELECT id
          FROM inventory.bom_revisions
          WHERE organization_id = current_setting('app.current_org_id', true)
        )) WITH CHECK (bom_revision_id IN (
          SELECT id
          FROM inventory.bom_revisions
          WHERE organization_id = current_setting('app.current_org_id', true)
        ));--> statement-breakpoint
CREATE POLICY "bom_revisions_org_isolation" ON "inventory"."bom_revisions" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
GRANT USAGE ON SCHEMA "inventory" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."bom_revisions" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."bom_revision_components" TO app_user;--> statement-breakpoint
WITH inserted_revisions AS (
  INSERT INTO "inventory"."bom_revisions" (
    "organization_id",
    "product_id",
    "revision_number",
    "is_current",
    "note",
    "created_by"
  )
  SELECT
    i."organization_id",
    bc."item_id",
    1,
    true,
    NULL,
    COALESCE(i."bom_locked_by_user_id", 'migration')
  FROM (
    SELECT DISTINCT "item_id"
    FROM "inventory"."bom_components"
  ) bc
  INNER JOIN "inventory"."items" i
    ON i."id" = bc."item_id"
  RETURNING "id", "product_id"
)
INSERT INTO "inventory"."bom_revision_components" (
  "bom_revision_id",
  "component_id",
  "component_name",
  "component_sku",
  "component_item_type",
  "unit_name",
  "quantity",
  "sort_order"
)
SELECT
  ir."id",
  bc."component_id",
  component."name",
  component."sku",
  component."item_type",
  unit_def."name",
  bc."quantity",
  ROW_NUMBER() OVER (PARTITION BY bc."item_id" ORDER BY bc."created_at", bc."id") - 1
FROM "inventory"."bom_components" bc
INNER JOIN inserted_revisions ir
  ON ir."product_id" = bc."item_id"
INNER JOIN "inventory"."items" component
  ON component."id" = bc."component_id"
INNER JOIN "inventory"."unit_definitions" unit_def
  ON unit_def."id" = component."unit_definition_id";
