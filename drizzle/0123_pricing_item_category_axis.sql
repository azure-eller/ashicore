DROP INDEX IF EXISTS "sales"."sales_pricing_schedules_scope_uidx";--> statement-breakpoint
DROP INDEX IF EXISTS "sales"."sales_pricing_schedules_everyone_uidx";--> statement-breakpoint
DROP INDEX IF EXISTS "sales"."sales_pricing_schedules_unit_definition_id_idx";--> statement-breakpoint
ALTER TABLE "sales"."pricing_schedules" ADD COLUMN IF NOT EXISTS "item_category" varchar(100);--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT organization_id, customer_category_id, item_category, COUNT(*) AS duplicate_count
      FROM "sales"."pricing_schedules"
      WHERE deleted_at IS NULL
      GROUP BY organization_id, customer_category_id, item_category
      HAVING COUNT(*) > 1
    ) duplicate_scopes
  ) THEN
    RAISE EXCEPTION 'Active pricing schedules contain duplicate customer/item-category scopes after removing unit_definition_id. Resolve duplicates before applying this migration.';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "sales"."pricing_schedules" DROP CONSTRAINT IF EXISTS "pricing_schedules_unit_definition_id_unit_definitions_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."pricing_schedules" DROP COLUMN IF EXISTS "unit_definition_id";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_pricing_schedules_item_category_idx" ON "sales"."pricing_schedules" USING btree ("item_category");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_pricing_schedules_customer_item_uidx" ON "sales"."pricing_schedules" USING btree ("organization_id","customer_category_id","item_category") WHERE "customer_category_id" IS NOT NULL AND "item_category" IS NOT NULL AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_pricing_schedules_customer_all_items_uidx" ON "sales"."pricing_schedules" USING btree ("organization_id","customer_category_id") WHERE "customer_category_id" IS NOT NULL AND "item_category" IS NULL AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_pricing_schedules_all_customers_item_uidx" ON "sales"."pricing_schedules" USING btree ("organization_id","item_category") WHERE "customer_category_id" IS NULL AND "item_category" IS NOT NULL AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_pricing_schedules_all_customers_all_items_uidx" ON "sales"."pricing_schedules" USING btree ("organization_id") WHERE "customer_category_id" IS NULL AND "item_category" IS NULL AND "deleted_at" IS NULL;
