CREATE TABLE IF NOT EXISTS "inventory"."stock_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "demand_type" varchar(40) NOT NULL,
  "demand_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "source_type" varchar(40) NOT NULL,
  "source_id" uuid,
  "quantity" numeric(12, 4) NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "demand_label_snapshot" text,
  "source_label_snapshot" text,
  "notes" text,
  "created_by" text,
  "updated_by" text,
  "cancelled_at" timestamp with time zone,
  "cancelled_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "stock_allocations_demand_type_check" CHECK ("demand_type" IN ('sales_order_line')),
  CONSTRAINT "stock_allocations_source_type_check" CHECK ("source_type" IN ('stock_pool', 'lot', 'manufacturing_order')),
  CONSTRAINT "stock_allocations_status_check" CHECK ("status" IN ('active', 'consumed', 'cancelled')),
  CONSTRAINT "stock_allocations_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "stock_allocations_source_id_check" CHECK (("source_type" = 'stock_pool' AND "source_id" IS NULL) OR ("source_type" <> 'stock_pool' AND "source_id" IS NOT NULL)),
  CONSTRAINT "stock_allocations_cancelled_check" CHECK (("status" = 'cancelled' AND "cancelled_at" IS NOT NULL) OR ("status" <> 'cancelled' AND "cancelled_at" IS NULL))
);
--> statement-breakpoint ALTER TABLE "inventory"."stock_allocations" DROP CONSTRAINT IF EXISTS "stock_allocations_item_id_items_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."stock_allocations" ADD CONSTRAINT "stock_allocations_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "inventory"."items"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_allocations_org_item_status_idx" ON "inventory"."stock_allocations" USING btree ("organization_id","item_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_allocations_demand_idx" ON "inventory"."stock_allocations" USING btree ("organization_id","demand_type","demand_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_allocations_source_idx" ON "inventory"."stock_allocations" USING btree ("organization_id","source_type","source_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_allocations_item_source_idx" ON "inventory"."stock_allocations" USING btree ("organization_id","item_id","source_type","source_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_allocations_active_stock_pool_uidx" ON "inventory"."stock_allocations" USING btree ("organization_id","demand_type","demand_id","source_type") WHERE status = 'active' AND source_type = 'stock_pool';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_allocations_active_source_uidx" ON "inventory"."stock_allocations" USING btree ("organization_id","demand_type","demand_id","source_type","source_id") WHERE status = 'active' AND source_type <> 'stock_pool';
--> statement-breakpoint
ALTER TABLE "inventory"."stock_allocations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory"."stock_allocations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "stock_allocations_org_isolation" ON "inventory"."stock_allocations";
--> statement-breakpoint
CREATE POLICY "stock_allocations_org_isolation" ON "inventory"."stock_allocations" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."stock_allocations" TO app_user;
--> statement-breakpoint
INSERT INTO "inventory"."stock_allocations" (
  "organization_id",
  "demand_type",
  "demand_id",
  "item_id",
  "source_type",
  "source_id",
  "quantity",
  "status",
  "created_by",
  "updated_by",
  "cancelled_at",
  "cancelled_by",
  "created_at",
  "updated_at"
)
SELECT
  old."organization_id",
  'sales_order_line',
  old."sales_order_line_id",
  old."item_id",
  old."source_type",
  old."source_id",
  old."quantity",
  old."status",
  old."created_by",
  old."updated_by",
  old."cancelled_at",
  old."cancelled_by",
  old."created_at",
  old."updated_at"
FROM "sales"."sales_order_allocations" old
WHERE NOT EXISTS (
  SELECT 1
  FROM "inventory"."stock_allocations" existing
  WHERE existing."organization_id" = old."organization_id"
    AND existing."demand_type" = 'sales_order_line'
    AND existing."demand_id" = old."sales_order_line_id"
    AND existing."source_type" = old."source_type"
    AND (
      (existing."source_id" IS NULL AND old."source_id" IS NULL)
      OR existing."source_id" = old."source_id"
    )
    AND existing."status" = old."status"
);
