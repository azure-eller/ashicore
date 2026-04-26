ALTER TABLE "sales"."sales_orders" ADD COLUMN IF NOT EXISTS "xero_push_payload_hash" text;--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ADD COLUMN IF NOT EXISTS "xero_last_push_attempt_at" timestamp;--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ADD COLUMN IF NOT EXISTS "xero_retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ADD COLUMN IF NOT EXISTS "xero_email_status" varchar(20);--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ADD COLUMN IF NOT EXISTS "xero_email_error" text;--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ADD COLUMN IF NOT EXISTS "xero_emailed_at" timestamp;--> statement-breakpoint
ALTER TABLE "xero"."xero_connections" ADD COLUMN IF NOT EXISTS "auto_email_sales_invoices" boolean DEFAULT false NOT NULL;