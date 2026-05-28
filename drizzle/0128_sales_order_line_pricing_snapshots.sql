ALTER TABLE "sales"."sales_order_lines" ADD COLUMN IF NOT EXISTS "list_unit_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD COLUMN IF NOT EXISTS "discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
UPDATE "sales"."sales_order_lines" line
SET "list_unit_price" = COALESCE(item."default_selling_price", line."suggested_unit_price", line."unit_price")
FROM "inventory"."items" item
WHERE line."item_id" = item."id"
  AND line."list_unit_price" IS NULL;--> statement-breakpoint
UPDATE "sales"."sales_order_lines"
SET "list_unit_price" = "unit_price"
WHERE "list_unit_price" IS NULL;--> statement-breakpoint
UPDATE "sales"."sales_order_lines"
SET "discount_percent" = CASE
  WHEN "list_unit_price" > 0 AND "unit_price" < "list_unit_price"
    THEN ROUND((("list_unit_price" - "unit_price") / "list_unit_price") * 100, 2)
  ELSE 0
END;
