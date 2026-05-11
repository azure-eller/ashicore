ALTER TABLE "xero"."xero_connections" ALTER COLUMN "invoice_status_preference" SET DEFAULT 'DRAFT';--> statement-breakpoint
ALTER TABLE "xero"."xero_connections" ALTER COLUMN "purchase_order_status_preference" SET DEFAULT 'DRAFT';--> statement-breakpoint
ALTER TABLE "xero"."xero_connections" ADD COLUMN IF NOT EXISTS "auto_push_sales_invoices" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "xero"."xero_connections" ADD COLUMN IF NOT EXISTS "auto_push_purchase_orders" boolean DEFAULT true NOT NULL;
