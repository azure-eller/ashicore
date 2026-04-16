ALTER TABLE "sales"."sales_orders" RENAME COLUMN "fulfilled_at" TO "shipped_at";--> statement-breakpoint
UPDATE "sales"."sales_orders" SET "status" = 'shipped' WHERE "status" = 'fulfilled';--> statement-breakpoint
UPDATE "inventory"."stock_movements" SET "movement_type" = 'sales_shipped' WHERE "movement_type" = 'sales_fulfilled';
