ALTER TABLE "integrations"."connections" ADD COLUMN IF NOT EXISTS "auto_sync_purchase_orders_from_accounting" boolean DEFAULT false NOT NULL;
