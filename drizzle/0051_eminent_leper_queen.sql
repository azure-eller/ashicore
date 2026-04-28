ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "xero_purchase_order_id" text;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "xero_purchase_order_number" varchar(50);--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "xero_push_status" varchar(20);--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "xero_push_error" text;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "xero_pushed_at" timestamp;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "xero_push_payload_hash" text;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "xero_last_push_attempt_at" timestamp;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "xero_retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "xero"."xero_connections" ADD COLUMN IF NOT EXISTS "purchase_order_default_account_code" varchar(20);--> statement-breakpoint
ALTER TABLE "xero"."xero_connections" ADD COLUMN IF NOT EXISTS "purchase_order_default_tax_type" varchar(50);--> statement-breakpoint
ALTER TABLE "xero"."xero_connections" ADD COLUMN IF NOT EXISTS "purchase_order_status_preference" varchar(20) DEFAULT 'DRAFT' NOT NULL;