ALTER TABLE "sales"."customers" ADD COLUMN IF NOT EXISTS "account_state" varchar(20) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN IF NOT EXISTS "account_priority" varchar(20) DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ADD COLUMN IF NOT EXISTS "customer_project_id" uuid;--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" DROP CONSTRAINT IF EXISTS "sales_orders_customer_project_id_customer_projects_id_fk";--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ADD CONSTRAINT "sales_orders_customer_project_id_customer_projects_id_fk" FOREIGN KEY ("customer_project_id") REFERENCES "sales"."customer_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customers_account_state_idx" ON "sales"."customers" USING btree ("account_state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customers_account_priority_idx" ON "sales"."customers" USING btree ("account_priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_orders_customer_id_idx" ON "sales"."sales_orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_orders_customer_project_id_idx" ON "sales"."sales_orders" USING btree ("customer_project_id");--> statement-breakpoint
ALTER TABLE "sales"."customers" DROP CONSTRAINT IF EXISTS "sales_customers_account_state_check";--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD CONSTRAINT "sales_customers_account_state_check" CHECK ("sales"."customers"."account_state" IN ('onboarding', 'active', 'growth', 'at_risk', 'dormant', 'former'));--> statement-breakpoint
ALTER TABLE "sales"."customers" DROP CONSTRAINT IF EXISTS "sales_customers_account_priority_check";--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD CONSTRAINT "sales_customers_account_priority_check" CHECK ("sales"."customers"."account_priority" IN ('strategic', 'high', 'standard', 'low'));
