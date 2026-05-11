ALTER TABLE "sales"."sales_shipments" ADD COLUMN IF NOT EXISTS "xero_invoice_id" text;--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" ADD COLUMN IF NOT EXISTS "xero_invoice_number" varchar(50);--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" ADD COLUMN IF NOT EXISTS "xero_push_status" varchar(20);--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" ADD COLUMN IF NOT EXISTS "xero_push_error" text;--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" ADD COLUMN IF NOT EXISTS "xero_pushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" ADD COLUMN IF NOT EXISTS "xero_push_payload_hash" text;--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" ADD COLUMN IF NOT EXISTS "xero_last_push_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" ADD COLUMN IF NOT EXISTS "xero_retry_count" integer DEFAULT 0 NOT NULL;