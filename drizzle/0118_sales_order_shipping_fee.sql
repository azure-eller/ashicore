ALTER TABLE "sales"."sales_orders" ADD COLUMN IF NOT EXISTS "shipping_fee_description" varchar(255);
ALTER TABLE "sales"."sales_orders" ADD COLUMN IF NOT EXISTS "shipping_fee_amount" numeric(12, 2) DEFAULT '0' NOT NULL;
ALTER TABLE "sales"."sales_orders" ADD COLUMN IF NOT EXISTS "shipping_fee_tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL;
