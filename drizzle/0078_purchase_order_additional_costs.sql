CREATE TABLE IF NOT EXISTS "purchasing"."purchase_order_additional_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"cost_type" varchar(20) NOT NULL,
	"reference" varchar(120),
	"distribution_method" varchar(20) NOT NULL,
	"xero_purchase_account_code" varchar(20),
	"amount" numeric(12, 4) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_additional_costs_type_check" CHECK (cost_type IN ('shipping', 'customs', 'other')),
	CONSTRAINT "purchase_order_additional_costs_distribution_check" CHECK (distribution_method IN ('by_value', 'not_distributed')),
	CONSTRAINT "purchase_order_additional_costs_amount_check" CHECK (amount >= 0)
);
--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_additional_costs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_additional_costs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_additional_costs" DROP CONSTRAINT IF EXISTS "purchase_order_additional_costs_purchase_order_id_purchase_orders_id_fk";--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_additional_costs" ADD CONSTRAINT "purchase_order_additional_costs_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "purchasing"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_order_additional_costs_org_id_idx" ON "purchasing"."purchase_order_additional_costs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_order_additional_costs_order_id_idx" ON "purchasing"."purchase_order_additional_costs" USING btree ("purchase_order_id");--> statement-breakpoint
DROP POLICY IF EXISTS "purchase_order_additional_costs_org_isolation" ON "purchasing"."purchase_order_additional_costs";--> statement-breakpoint
CREATE POLICY "purchase_order_additional_costs_org_isolation" ON "purchasing"."purchase_order_additional_costs" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
INSERT INTO "purchasing"."purchase_order_additional_costs" (
	"organization_id",
	"purchase_order_id",
	"cost_type",
	"distribution_method",
	"amount",
	"sort_order"
)
SELECT
	po."organization_id",
	po."id",
	'shipping',
	'by_value',
	po."shipping_cost",
	0
FROM "purchasing"."purchase_orders" po
WHERE po."shipping_cost" > 0
	AND NOT EXISTS (
		SELECT 1
		FROM "purchasing"."purchase_order_additional_costs" cost
		WHERE cost."purchase_order_id" = po."id"
			AND cost."cost_type" = 'shipping'
			AND cost."amount" = po."shipping_cost"
	);--> statement-breakpoint
GRANT USAGE ON SCHEMA "purchasing" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "purchasing"."purchase_order_additional_costs" TO app_user;
