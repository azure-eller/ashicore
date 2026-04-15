CREATE SCHEMA "xero";
--> statement-breakpoint
CREATE TABLE "xero"."xero_connections" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"tenant_name" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"token_expires_at" timestamp NOT NULL,
	"default_account_code" varchar(20),
	"default_tax_type" varchar(50),
	"invoice_status_preference" varchar(20) DEFAULT 'AUTHORISED' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "xero"."xero_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "xero"."xero_connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT USAGE ON SCHEMA "xero" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "xero"."xero_connections" TO app_user;--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN "xero_contact_id" text;--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ADD COLUMN "xero_invoice_id" text;--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ADD COLUMN "xero_invoice_number" varchar(50);--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ADD COLUMN "xero_push_status" varchar(20);--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ADD COLUMN "xero_push_error" text;--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ADD COLUMN "xero_pushed_at" timestamp;--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" ADD COLUMN "xero_contact_id" text;--> statement-breakpoint
CREATE INDEX "xero_connections_tenant_idx" ON "xero"."xero_connections" USING btree ("tenant_id");--> statement-breakpoint
CREATE POLICY "xero_connections_org_isolation" ON "xero"."xero_connections" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));