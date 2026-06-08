ALTER TABLE "purchasing"."purchase_order_additional_costs" RENAME COLUMN "vendor_override_supplier_id" TO "supplier_id";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_type_check";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_parent_type_check";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_additional_costs" DROP CONSTRAINT IF EXISTS "purchase_order_additional_costs_vendor_override_supplier_id_suppliers_id_fk";
--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_additional_costs" DROP CONSTRAINT IF EXISTS "purchase_order_additional_costs_vendor_override_org_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "purchasing"."purchase_order_additional_costs_vendor_override_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "purchasing"."purchase_orders_org_parent_freight_supplier_uidx";--> statement-breakpoint
UPDATE "purchasing"."purchase_orders"
SET "deleted_at" = COALESCE("cancelled_at", now()),
    "updated_at" = now()
WHERE ("status" = 'cancelled' OR ("type" = 'freight' AND "parent_purchase_order_id" IS NULL))
  AND "deleted_at" IS NULL;--> statement-breakpoint
UPDATE "purchasing"."purchase_orders"
SET "type" = 'additional_cost',
    "notes" = CASE
      WHEN "notes" LIKE 'Freight for %'
        THEN 'Additional cost for ' || substring("notes" from 13)
      ELSE "notes"
    END
WHERE "type" = 'freight';--> statement-breakpoint ALTER TABLE "purchasing"."purchase_order_additional_costs" DROP CONSTRAINT IF EXISTS "purchase_order_additional_costs_supplier_id_suppliers_id_fk";--> statement-breakpoint
UPDATE "accounting"."document_syncs"
SET "group_key" = 'additional-cost:' || substring("group_key" from 9),
    "updated_at" = now()
WHERE "group_key" LIKE 'freight:%';--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_additional_costs" ADD CONSTRAINT "purchase_order_additional_costs_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "purchasing"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint ALTER TABLE "purchasing"."purchase_order_additional_costs" DROP CONSTRAINT IF EXISTS "purchase_order_additional_costs_supplier_org_fk";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchasing_suppliers_org_id_uidx" ON "purchasing"."suppliers" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_additional_costs" ADD CONSTRAINT "purchase_order_additional_costs_supplier_org_fk" FOREIGN KEY ("organization_id","supplier_id") REFERENCES "purchasing"."suppliers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_order_additional_costs_supplier_id_idx" ON "purchasing"."purchase_order_additional_costs" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_orders_org_parent_additional_cost_supplier_uidx" ON "purchasing"."purchase_orders" USING btree ("organization_id","parent_purchase_order_id","supplier_id") WHERE type = 'additional_cost' AND deleted_at IS NULL;--> statement-breakpoint ALTER TABLE "purchasing"."purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_type_check";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD CONSTRAINT "purchase_orders_type_check" CHECK (type IN ('standard', 'additional_cost'));--> statement-breakpoint ALTER TABLE "purchasing"."purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_parent_type_check";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD CONSTRAINT "purchase_orders_parent_type_check" CHECK ((type = 'standard' AND parent_purchase_order_id IS NULL) OR (type = 'additional_cost' AND parent_purchase_order_id IS NOT NULL));
