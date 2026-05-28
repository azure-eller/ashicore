ALTER TABLE "inventory"."stocktake_items" ADD COLUMN IF NOT EXISTS "notes" text;--> statement-breakpoint
ALTER TABLE "inventory"."stocktake_lot_items" ADD COLUMN IF NOT EXISTS "notes" text;
