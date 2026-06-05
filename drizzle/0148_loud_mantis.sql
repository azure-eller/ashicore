DROP INDEX IF EXISTS "accounting"."accounting_document_syncs_document_uidx";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_additional_costs" ADD COLUMN IF NOT EXISTS "vendor_override_supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "parent_purchase_order_id" uuid;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "type" varchar(20) DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "purchase_bill_manual_status" varchar(20);--> statement-breakpoint
ALTER TABLE "accounting"."document_syncs" ADD COLUMN IF NOT EXISTS "group_key" varchar(120) DEFAULT 'default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_orders_org_id_uidx" ON "purchasing"."purchase_orders" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchasing_suppliers_org_id_uidx" ON "purchasing"."suppliers" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_additional_costs" DROP CONSTRAINT IF EXISTS "purchase_order_additional_costs_vendor_override_supplier_id_suppliers_id_fk";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_additional_costs" ADD CONSTRAINT "purchase_order_additional_costs_vendor_override_supplier_id_suppliers_id_fk" FOREIGN KEY ("vendor_override_supplier_id") REFERENCES "purchasing"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_additional_costs" DROP CONSTRAINT IF EXISTS "purchase_order_additional_costs_vendor_override_org_fk";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_additional_costs" ADD CONSTRAINT "purchase_order_additional_costs_vendor_override_org_fk" FOREIGN KEY ("organization_id","vendor_override_supplier_id") REFERENCES "purchasing"."suppliers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_parent_id_fk";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD CONSTRAINT "purchase_orders_parent_id_fk" FOREIGN KEY ("parent_purchase_order_id") REFERENCES "purchasing"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_parent_org_id_fk";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD CONSTRAINT "purchase_orders_parent_org_id_fk" FOREIGN KEY ("organization_id","parent_purchase_order_id") REFERENCES "purchasing"."purchase_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_order_additional_costs_vendor_override_idx" ON "purchasing"."purchase_order_additional_costs" USING btree ("vendor_override_supplier_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_orders_parent_id_idx" ON "purchasing"."purchase_orders" USING btree ("parent_purchase_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_orders_org_parent_freight_supplier_uidx" ON "purchasing"."purchase_orders" USING btree ("organization_id","parent_purchase_order_id","supplier_id") WHERE type = 'freight' AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_document_syncs_document_uidx" ON "accounting"."document_syncs" USING btree ("organization_id","provider","document_type","document_id","group_key");--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_type_check";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD CONSTRAINT "purchase_orders_type_check" CHECK (type IN ('standard', 'freight'));--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_purchase_bill_manual_status_check";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD CONSTRAINT "purchase_orders_purchase_bill_manual_status_check" CHECK (purchase_bill_manual_status IS NULL OR purchase_bill_manual_status IN ('not_billed', 'partly_billed', 'billed'));--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_parent_type_check";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD CONSTRAINT "purchase_orders_parent_type_check" CHECK ((type = 'standard' AND parent_purchase_order_id IS NULL) OR (type = 'freight' AND parent_purchase_order_id IS NOT NULL));
