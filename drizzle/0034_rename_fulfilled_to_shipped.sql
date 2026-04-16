DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'sales' AND table_name = 'sales_orders' AND column_name = 'fulfilled_at'
  ) THEN
    ALTER TABLE "sales"."sales_orders" RENAME COLUMN "fulfilled_at" TO "shipped_at";
  END IF;
END $$;--> statement-breakpoint
UPDATE "sales"."sales_orders" SET "status" = 'shipped' WHERE "status" = 'fulfilled';--> statement-breakpoint
UPDATE "inventory"."stock_movements" SET "movement_type" = 'sales_shipped' WHERE "movement_type" = 'sales_fulfilled';
