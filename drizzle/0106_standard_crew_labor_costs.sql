CREATE TABLE IF NOT EXISTS "manufacturing"."resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" varchar(500),
	"resource_type" varchar(20) NOT NULL,
	"loaded_cost_per_hour" numeric(18, 6) NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manufacturing_resources_type_check" CHECK ("resource_type" IN ('labor', 'machine', 'overhead', 'other')),
	CONSTRAINT "manufacturing_resources_loaded_cost_check" CHECK ("loaded_cost_per_hour" >= 0)
);

ALTER TABLE "inventory"."items"
	ADD COLUMN IF NOT EXISTS "standard_cost_quantity" numeric(12, 4);

ALTER TABLE "manufacturing"."manufacturing_orders"
	ADD COLUMN IF NOT EXISTS "actual_operations_cost" numeric(18, 6);

UPDATE "manufacturing"."manufacturing_orders"
SET "actual_operations_cost" = 0
WHERE "status" = 'done'
	AND "actual_operations_cost" IS NULL;

CREATE TABLE IF NOT EXISTS "inventory"."bom_revision_operation_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bom_revision_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"operation_name" varchar(255) NOT NULL,
	"resource_name" varchar(255) NOT NULL,
	"resource_type" varchar(20) NOT NULL,
	"cost_scaling_mode" varchar(30) NOT NULL,
	"crew_size" numeric(12, 4) NOT NULL,
	"planned_minutes" numeric(12, 4) NOT NULL,
	"loaded_cost_per_hour" numeric(18, 6) NOT NULL,
	"planned_cost_total" numeric(18, 6) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bom_revision_operation_costs_scaling_mode_check" CHECK ("cost_scaling_mode" IN ('per_output_unit', 'fixed_per_mo')),
	CONSTRAINT "bom_revision_operation_costs_crew_size_check" CHECK ("crew_size" > 0),
	CONSTRAINT "bom_revision_operation_costs_minutes_check" CHECK ("planned_minutes" > 0),
	CONSTRAINT "bom_revision_operation_costs_rate_check" CHECK ("loaded_cost_per_hour" >= 0),
	CONSTRAINT "bom_revision_operation_costs_total_check" CHECK ("planned_cost_total" >= 0)
);

CREATE TABLE IF NOT EXISTS "manufacturing"."manufacturing_order_operation_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manufacturing_order_id" uuid NOT NULL,
	"source_bom_revision_operation_cost_id" uuid,
	"resource_id" uuid,
	"operation_name" varchar(255) NOT NULL,
	"resource_name" varchar(255) NOT NULL,
	"resource_type" varchar(20) NOT NULL,
	"cost_scaling_mode" varchar(30) NOT NULL,
	"crew_size" numeric(12, 4) NOT NULL,
	"planned_minutes" numeric(12, 4) NOT NULL,
	"planned_quantity_basis" numeric(12, 4),
	"loaded_cost_per_hour" numeric(18, 6) NOT NULL,
	"planned_cost_total" numeric(18, 6) NOT NULL,
	"actual_crew_size" numeric(12, 4),
	"actual_minutes" numeric(12, 4),
	"actual_cost_total" numeric(18, 6),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manufacturing_order_operation_costs_scaling_mode_check" CHECK ("cost_scaling_mode" IN ('per_output_unit', 'fixed_per_mo')),
	CONSTRAINT "manufacturing_order_operation_costs_crew_check" CHECK ("crew_size" > 0),
	CONSTRAINT "manufacturing_order_operation_costs_minutes_check" CHECK ("planned_minutes" > 0),
	CONSTRAINT "manufacturing_order_operation_costs_rate_check" CHECK ("loaded_cost_per_hour" >= 0),
	CONSTRAINT "manufacturing_order_operation_costs_total_check" CHECK ("planned_cost_total" >= 0)
);

DO $$ BEGIN
	ALTER TABLE "inventory"."items" ADD CONSTRAINT "items_standard_cost_quantity_positive" CHECK ("standard_cost_quantity" IS NULL OR "standard_cost_quantity" > 0);
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
	ALTER TABLE "inventory"."bom_revision_operation_costs" ADD CONSTRAINT "bom_revision_operation_costs_revision_fk" FOREIGN KEY ("bom_revision_id") REFERENCES "inventory"."bom_revisions"("id") ON DELETE cascade;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
	ALTER TABLE "inventory"."bom_revision_operation_costs" ADD CONSTRAINT "bom_revision_operation_costs_resource_fk" FOREIGN KEY ("resource_id") REFERENCES "manufacturing"."resources"("id") ON DELETE restrict;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
	ALTER TABLE "manufacturing"."manufacturing_order_operation_costs" ADD CONSTRAINT "manufacturing_order_operation_costs_order_fk" FOREIGN KEY ("manufacturing_order_id") REFERENCES "manufacturing"."manufacturing_orders"("id") ON DELETE cascade;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
	ALTER TABLE "manufacturing"."manufacturing_order_operation_costs" ADD CONSTRAINT "manufacturing_order_operation_costs_source_fk" FOREIGN KEY ("source_bom_revision_operation_cost_id") REFERENCES "inventory"."bom_revision_operation_costs"("id") ON DELETE set null;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
	ALTER TABLE "manufacturing"."manufacturing_order_operation_costs" ADD CONSTRAINT "manufacturing_order_operation_costs_resource_fk" FOREIGN KEY ("resource_id") REFERENCES "manufacturing"."resources"("id") ON DELETE restrict;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "manufacturing_resources_org_idx" ON "manufacturing"."resources" USING btree ("organization_id");
CREATE INDEX IF NOT EXISTS "manufacturing_resources_active_idx" ON "manufacturing"."resources" USING btree ("organization_id","name") WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS "bom_revision_operation_costs_revision_idx" ON "inventory"."bom_revision_operation_costs" USING btree ("bom_revision_id");
CREATE INDEX IF NOT EXISTS "bom_revision_operation_costs_resource_idx" ON "inventory"."bom_revision_operation_costs" USING btree ("resource_id");
CREATE INDEX IF NOT EXISTS "manufacturing_order_operation_costs_order_idx" ON "manufacturing"."manufacturing_order_operation_costs" USING btree ("manufacturing_order_id");
CREATE INDEX IF NOT EXISTS "manufacturing_order_operation_costs_source_idx" ON "manufacturing"."manufacturing_order_operation_costs" USING btree ("source_bom_revision_operation_cost_id");

ALTER TABLE "manufacturing"."resources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "manufacturing"."resources" FORCE ROW LEVEL SECURITY;
ALTER TABLE "inventory"."bom_revision_operation_costs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory"."bom_revision_operation_costs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "manufacturing"."manufacturing_order_operation_costs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "manufacturing"."manufacturing_order_operation_costs" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "manufacturing_resources_org_isolation" ON "manufacturing"."resources";
CREATE POLICY "manufacturing_resources_org_isolation" ON "manufacturing"."resources"
	AS PERMISSIVE FOR ALL TO public
	USING ("organization_id" = current_setting('app.current_org_id', true))
	WITH CHECK ("organization_id" = current_setting('app.current_org_id', true));

DROP POLICY IF EXISTS "bom_revision_operation_costs_org_isolation" ON "inventory"."bom_revision_operation_costs";
CREATE POLICY "bom_revision_operation_costs_org_isolation" ON "inventory"."bom_revision_operation_costs"
	AS PERMISSIVE FOR ALL TO public
	USING ("bom_revision_id" IN (
		SELECT "id" FROM "inventory"."bom_revisions"
		WHERE "organization_id" = current_setting('app.current_org_id', true)
	))
	WITH CHECK ("bom_revision_id" IN (
		SELECT "id" FROM "inventory"."bom_revisions"
		WHERE "organization_id" = current_setting('app.current_org_id', true)
	));

DROP POLICY IF EXISTS "manufacturing_order_operation_costs_org_isolation" ON "manufacturing"."manufacturing_order_operation_costs";
CREATE POLICY "manufacturing_order_operation_costs_org_isolation" ON "manufacturing"."manufacturing_order_operation_costs"
	AS PERMISSIVE FOR ALL TO public
	USING ("manufacturing_order_id" IN (
		SELECT "id" FROM "manufacturing"."manufacturing_orders"
		WHERE "organization_id" = current_setting('app.current_org_id', true)
	))
	WITH CHECK ("manufacturing_order_id" IN (
		SELECT "id" FROM "manufacturing"."manufacturing_orders"
		WHERE "organization_id" = current_setting('app.current_org_id', true)
	));

GRANT USAGE ON SCHEMA "inventory" TO app_user;
GRANT USAGE ON SCHEMA "manufacturing" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manufacturing"."resources" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."bom_revision_operation_costs" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "manufacturing"."manufacturing_order_operation_costs" TO app_user;
