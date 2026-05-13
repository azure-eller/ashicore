ALTER TABLE "inventory"."items" ADD COLUMN IF NOT EXISTS "xero_item_id" text;--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD COLUMN IF NOT EXISTS "xero_item_code" varchar(100);--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD COLUMN IF NOT EXISTS "xero_item_name" varchar(255);--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD COLUMN IF NOT EXISTS "xero_purchase_description" text;--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD COLUMN IF NOT EXISTS "xero_purchase_tax_type" varchar(50);--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD COLUMN IF NOT EXISTS "xero_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" ADD COLUMN IF NOT EXISTS "xero_contact_number" varchar(100);--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" ADD COLUMN IF NOT EXISTS "xero_account_number" varchar(100);--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" ADD COLUMN IF NOT EXISTS "xero_purchases_default_account_code" varchar(20);--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" ADD COLUMN IF NOT EXISTS "xero_accounts_payable_tax_type" varchar(50);--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" ADD COLUMN IF NOT EXISTS "xero_updated_at" timestamp with time zone;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."items" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "purchasing"."suppliers" TO app_user;
