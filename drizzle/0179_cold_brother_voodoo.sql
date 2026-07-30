ALTER TABLE "inventory"."stocktake_items" ALTER COLUMN "item_name" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ALTER COLUMN "item_name" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients" ALTER COLUMN "item_name" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_orders" ALTER COLUMN "product_name" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines" ALTER COLUMN "item_name" SET DATA TYPE text;