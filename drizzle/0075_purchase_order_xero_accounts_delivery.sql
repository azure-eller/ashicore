ALTER TABLE "inventory"."items" ADD COLUMN IF NOT EXISTS "xero_purchase_account_code" varchar(20);--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "xero_purchase_account_code" varchar(20);--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "ship_line1" varchar(255);--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "ship_line2" varchar(255);--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "ship_city" varchar(120);--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "ship_region" varchar(120);--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "ship_postcode" varchar(30);--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "ship_country" varchar(120);--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines" ADD COLUMN IF NOT EXISTS "xero_purchase_account_code" varchar(20);--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_additional_costs" ADD COLUMN IF NOT EXISTS "xero_purchase_account_code" varchar(20);
