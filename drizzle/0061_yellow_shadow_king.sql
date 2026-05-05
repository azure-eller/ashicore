ALTER TABLE "sales"."sales_orders" ADD COLUMN IF NOT EXISTS "order_date" date;--> statement-breakpoint
UPDATE "sales"."sales_orders"
SET "order_date" = "created_at"::date
WHERE "order_date" IS NULL;--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ALTER COLUMN "order_date" SET DEFAULT CURRENT_DATE;--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ALTER COLUMN "order_date" SET NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_orders_order_date_idx" ON "sales"."sales_orders" USING btree ("order_date");
