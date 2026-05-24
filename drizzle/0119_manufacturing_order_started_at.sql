ALTER TABLE "manufacturing"."manufacturing_orders"
  ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;
