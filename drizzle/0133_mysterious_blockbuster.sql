DROP INDEX "inventory"."stocktake_lot_items_stocktake_item_lot_uidx";--> statement-breakpoint
ALTER TABLE "inventory"."stocktake_lot_items" ALTER COLUMN "lot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory"."stocktake_lot_items" ADD COLUMN IF NOT EXISTS "is_found" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stocktake_lot_items_stocktake_item_lot_uidx" ON "inventory"."stocktake_lot_items" USING btree ("stocktake_item_id","lot_id") WHERE lot_id IS NOT NULL;