DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sales.pricing_schedules
    WHERE deleted_at IS NULL
      AND item_category IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Active item-category pricing schedules exist. Re-create them with selected items before applying 0124.';
  END IF;
END $$;--> statement-breakpoint

DROP INDEX IF EXISTS "sales"."sales_pricing_schedules_customer_item_uidx";--> statement-breakpoint
DROP INDEX IF EXISTS "sales"."sales_pricing_schedules_customer_all_items_uidx";--> statement-breakpoint
DROP INDEX IF EXISTS "sales"."sales_pricing_schedules_all_customers_item_uidx";--> statement-breakpoint
DROP INDEX IF EXISTS "sales"."sales_pricing_schedules_all_customers_all_items_uidx";--> statement-breakpoint
DROP INDEX IF EXISTS "sales"."sales_pricing_schedules_item_category_idx";--> statement-breakpoint

ALTER TABLE "sales"."pricing_schedules"
  ADD COLUMN IF NOT EXISTS "item_scope" varchar(20) NOT NULL DEFAULT 'all';--> statement-breakpoint
ALTER TABLE "sales"."pricing_schedules"
  DROP COLUMN IF EXISTS "item_category";--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sales"."pricing_schedule_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "pricing_schedule_id" uuid NOT NULL,
  "customer_category_id" uuid,
  "item_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pricing_schedule_items_pricing_schedule_id_pricing_schedules_id_fk"
    FOREIGN KEY ("pricing_schedule_id") REFERENCES "sales"."pricing_schedules"("id") ON DELETE cascade,
  CONSTRAINT "pricing_schedule_items_customer_category_id_customer_categories_id_fk"
    FOREIGN KEY ("customer_category_id") REFERENCES "sales"."customer_categories"("id"),
  CONSTRAINT "pricing_schedule_items_item_id_items_id_fk"
    FOREIGN KEY ("item_id") REFERENCES "inventory"."items"("id")
);--> statement-breakpoint

ALTER TABLE "sales"."pricing_schedule_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."pricing_schedule_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "sales_pricing_schedule_items_org_isolation" ON "sales"."pricing_schedule_items";--> statement-breakpoint
CREATE POLICY "sales_pricing_schedule_items_org_isolation" ON "sales"."pricing_schedule_items" AS PERMISSIVE FOR ALL TO public
  USING (organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sales_pricing_schedule_items_org_id_idx"
  ON "sales"."pricing_schedule_items" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_pricing_schedule_items_schedule_id_idx"
  ON "sales"."pricing_schedule_items" USING btree ("pricing_schedule_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_pricing_schedule_items_item_id_idx"
  ON "sales"."pricing_schedule_items" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_pricing_schedule_items_schedule_item_uidx"
  ON "sales"."pricing_schedule_items" USING btree ("pricing_schedule_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_pricing_schedules_customer_all_items_uidx"
  ON "sales"."pricing_schedules" USING btree ("organization_id","customer_category_id")
  WHERE customer_category_id IS NOT NULL AND item_scope = 'all' AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_pricing_schedules_all_customers_all_items_uidx"
  ON "sales"."pricing_schedules" USING btree ("organization_id")
  WHERE customer_category_id IS NULL AND item_scope = 'all' AND deleted_at IS NULL;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sales"."pricing_schedule_items" TO app_user;
