ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "xero_po_email_status" varchar(20);--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "xero_po_email_error" text;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "xero_po_emailed_at" timestamp;--> statement-breakpoint
ALTER TABLE "xero"."xero_connections" ADD COLUMN IF NOT EXISTS "auto_email_purchase_orders" boolean DEFAULT false NOT NULL;