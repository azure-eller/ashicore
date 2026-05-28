CREATE SCHEMA IF NOT EXISTS "settings";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings"."tax_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" varchar(120) NOT NULL,
	"rate_percent" numeric(7, 4) NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings"."organization_tax_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"default_sales_tax_rate_id" uuid,
	"default_purchase_tax_rate_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$
BEGIN
	ALTER TABLE "settings"."organization_tax_settings" ADD CONSTRAINT "organization_tax_settings_default_sales_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("default_sales_tax_rate_id") REFERENCES "settings"."tax_rates"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$
BEGIN
	ALTER TABLE "settings"."organization_tax_settings" ADD CONSTRAINT "organization_tax_settings_default_purchase_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("default_purchase_tax_rate_id") REFERENCES "settings"."tax_rates"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$
BEGIN
	ALTER TABLE "sales"."sales_order_lines" ADD CONSTRAINT "sales_order_lines_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "settings"."tax_rates"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN undefined_column THEN NULL;
END $$;--> statement-breakpoint
DO $$
BEGIN
	ALTER TABLE "purchasing"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "settings"."tax_rates"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN NULL;
	WHEN undefined_column THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tax_rates_org_id_idx" ON "settings"."tax_rates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tax_rates_active_idx" ON "settings"."tax_rates" USING btree ("organization_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tax_rates_org_name_uidx" ON "settings"."tax_rates" USING btree ("organization_id","name") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_tax_settings_default_sales_idx" ON "settings"."organization_tax_settings" USING btree ("default_sales_tax_rate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_tax_settings_default_purchase_idx" ON "settings"."organization_tax_settings" USING btree ("default_purchase_tax_rate_id");--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ADD COLUMN IF NOT EXISTS "subtotal_amount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ADD COLUMN IF NOT EXISTS "tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD COLUMN IF NOT EXISTS "tax_rate_id" uuid;--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD COLUMN IF NOT EXISTS "tax_rate_name" varchar(120);--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD COLUMN IF NOT EXISTS "tax_rate_percent" numeric(7, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD COLUMN IF NOT EXISTS "line_subtotal" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD COLUMN IF NOT EXISTS "line_tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
DO $$
BEGIN
	ALTER TABLE "sales"."sales_order_lines" ADD CONSTRAINT "sales_order_lines_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "settings"."tax_rates"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
UPDATE "sales"."sales_order_lines" SET "line_subtotal" = "line_total", "line_tax_amount" = 0 WHERE "line_subtotal" = 0 AND "line_tax_amount" = 0;--> statement-breakpoint
UPDATE "sales"."sales_orders" SET "subtotal_amount" = "total_amount" - "shipping_fee_tax_amount", "tax_amount" = "shipping_fee_tax_amount" WHERE "subtotal_amount" = 0 AND "tax_amount" = 0;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "subtotal_amount" numeric(12, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "tax_amount" numeric(12, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines" ADD COLUMN IF NOT EXISTS "tax_rate_id" uuid;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines" ADD COLUMN IF NOT EXISTS "tax_rate_name" varchar(120);--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines" ADD COLUMN IF NOT EXISTS "tax_rate_percent" numeric(7, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines" ADD COLUMN IF NOT EXISTS "line_subtotal" numeric(12, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines" ADD COLUMN IF NOT EXISTS "line_tax_amount" numeric(12, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
DO $$
BEGIN
	ALTER TABLE "purchasing"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "settings"."tax_rates"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
UPDATE "purchasing"."purchase_order_lines" SET "line_subtotal" = "line_total", "line_tax_amount" = 0 WHERE "line_subtotal" = 0 AND "line_tax_amount" = 0;--> statement-breakpoint
UPDATE "purchasing"."purchase_orders" SET "subtotal_amount" = "total_amount", "tax_amount" = 0 WHERE "subtotal_amount" = 0 AND "tax_amount" = 0;--> statement-breakpoint
ALTER TABLE "settings"."tax_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settings"."tax_rates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settings"."organization_tax_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settings"."organization_tax_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tax_rates_org_isolation" ON "settings"."tax_rates";--> statement-breakpoint
CREATE POLICY "tax_rates_org_isolation" ON "settings"."tax_rates" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS "organization_tax_settings_org_isolation" ON "settings"."organization_tax_settings";--> statement-breakpoint
CREATE POLICY "organization_tax_settings_org_isolation" ON "settings"."organization_tax_settings" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
GRANT USAGE ON SCHEMA "settings" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "settings" TO app_user;
