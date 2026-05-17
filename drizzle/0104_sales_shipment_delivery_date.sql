ALTER TABLE "sales"."sales_shipments"
  ADD COLUMN IF NOT EXISTS "delivery_date" date;
--> statement-breakpoint
UPDATE "sales"."sales_shipments" AS shipment
SET "delivery_date" = orders."requested_date"
FROM "sales"."sales_orders" AS orders
WHERE shipment."sales_order_id" = orders."id"
  AND shipment."delivery_date" IS NULL
  AND orders."requested_date" IS NOT NULL;
