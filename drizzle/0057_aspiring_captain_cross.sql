CREATE TABLE IF NOT EXISTS "sales"."sales_shipment_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"sales_shipment_id" uuid NOT NULL,
	"cost_type" varchar(30) NOT NULL,
	"cost_status" varchar(20) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"vendor_name" varchar(255),
	"reference_number" varchar(120),
	"incurred_date" date,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sales_shipment_costs_type_check" CHECK (cost_type IN ('freight', 'delivery_labor', 'fuel', 'packaging', 'accessorial', 'other')),
	CONSTRAINT "sales_shipment_costs_status_check" CHECK (cost_status IN ('estimated', 'actual')),
	CONSTRAINT "sales_shipment_costs_amount_check" CHECK (amount > 0)
);
--> statement-breakpoint
ALTER TABLE "sales"."sales_shipment_costs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."sales_shipment_costs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" ADD COLUMN IF NOT EXISTS "customer_freight_charge_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "sales"."sales_shipment_costs" DROP CONSTRAINT IF EXISTS "sales_shipment_costs_sales_shipment_id_sales_shipments_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."sales_shipment_costs" ADD CONSTRAINT "sales_shipment_costs_sales_shipment_id_sales_shipments_id_fk" FOREIGN KEY ("sales_shipment_id") REFERENCES "sales"."sales_shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_shipment_costs_org_id_idx" ON "sales"."sales_shipment_costs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_shipment_costs_shipment_id_idx" ON "sales"."sales_shipment_costs" USING btree ("sales_shipment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_shipment_costs_status_idx" ON "sales"."sales_shipment_costs" USING btree ("organization_id","cost_status");--> statement-breakpoint
DROP POLICY IF EXISTS "sales_shipment_costs_org_isolation" ON "sales"."sales_shipment_costs";--> statement-breakpoint
CREATE POLICY "sales_shipment_costs_org_isolation" ON "sales"."sales_shipment_costs" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
GRANT USAGE ON SCHEMA "sales" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sales"."sales_shipment_costs" TO app_user;
