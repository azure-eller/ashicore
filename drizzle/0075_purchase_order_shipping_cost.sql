ALTER TABLE "purchasing"."purchase_orders" ADD COLUMN IF NOT EXISTS "shipping_cost" numeric(12, 4) DEFAULT '0' NOT NULL;
