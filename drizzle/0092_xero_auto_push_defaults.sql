ALTER TABLE "xero"."xero_connections" ALTER COLUMN "auto_push_sales_invoices" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "xero"."xero_connections" ALTER COLUMN "auto_push_purchase_orders" SET DEFAULT false;--> statement-breakpoint
UPDATE "xero"."xero_connections"
SET
  "auto_push_sales_invoices" = false,
  "auto_push_purchase_orders" = false,
  "updated_at" = now()
WHERE "auto_push_sales_invoices" = true
   OR "auto_push_purchase_orders" = true;
