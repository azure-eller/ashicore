ALTER TABLE "sales"."sales_orders" ADD COLUMN IF NOT EXISTS "ship_date" date;--> statement-breakpoint
UPDATE "sales"."sales_orders"
SET "ship_date" = "requested_date"
WHERE "ship_date" IS NULL
  AND "requested_date" IS NOT NULL;
