CREATE TABLE IF NOT EXISTS "system"."billing_period_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"billing_period_start" timestamp with time zone NOT NULL,
	"billing_period_end" timestamp with time zone NOT NULL,
	"from_band" varchar(20) NOT NULL,
	"to_band" varchar(20) NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"stripe_invoice_item_id" text,
	"stripe_invoice_id" text,
	"idempotency_key" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "system"."billing_period_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "system"."billing_period_adjustments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system"."billing_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"event_type" varchar(40) DEFAULT 'sales_order_shipped' NOT NULL,
	"billing_period_start" timestamp with time zone NOT NULL,
	"billing_period_end" timestamp with time zone NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "system"."billing_usage_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "system"."billing_usage_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "system"."organization" ADD COLUMN IF NOT EXISTS "current_period_start" timestamp with time zone;--> statement-breakpoint ALTER TABLE "system"."billing_usage_events" DROP CONSTRAINT IF EXISTS "billing_usage_events_sales_order_id_sales_orders_id_fk";--> statement-breakpoint
ALTER TABLE "system"."billing_usage_events" ADD CONSTRAINT "billing_usage_events_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "sales"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_period_adjustments_idempotency_uidx" ON "system"."billing_period_adjustments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_period_adjustments_org_period_band_uidx" ON "system"."billing_period_adjustments" USING btree ("organization_id","billing_period_start","to_band");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_period_adjustments_org_status_idx" ON "system"."billing_period_adjustments" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_usage_events_order_period_uidx" ON "system"."billing_usage_events" USING btree ("organization_id","sales_order_id","event_type","billing_period_start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_usage_events_org_period_idx" ON "system"."billing_usage_events" USING btree ("organization_id","billing_period_start","billing_period_end");--> statement-breakpoint DROP POLICY IF EXISTS "billing_period_adjustments_org_isolation" ON "system"."billing_period_adjustments";--> statement-breakpoint
CREATE POLICY "billing_period_adjustments_org_isolation" ON "system"."billing_period_adjustments" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint DROP POLICY IF EXISTS "billing_usage_events_org_isolation" ON "system"."billing_usage_events";--> statement-breakpoint
CREATE POLICY "billing_usage_events_org_isolation" ON "system"."billing_usage_events" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "system"."billing_period_adjustments" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "system"."billing_usage_events" TO app_user;--> statement-breakpoint
ALTER TABLE "system"."billing_period_adjustments" ADD COLUMN IF NOT EXISTS "retry_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "system"."billing_period_adjustments" ADD COLUMN IF NOT EXISTS "next_retry_at" timestamp with time zone;
