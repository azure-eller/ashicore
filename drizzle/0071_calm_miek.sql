ALTER TABLE "sales"."sales_shipments" ADD COLUMN IF NOT EXISTS "xero_email_status" varchar(20);--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" ADD COLUMN IF NOT EXISTS "xero_email_error" text;--> statement-breakpoint
ALTER TABLE "sales"."sales_shipments" ADD COLUMN IF NOT EXISTS "xero_emailed_at" timestamp with time zone;