ALTER TABLE "manufacturing"."manufacturing_orders" ADD COLUMN IF NOT EXISTS "is_blocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients" ADD COLUMN IF NOT EXISTS "lot_strategy" varchar(16) DEFAULT 'fifo' NOT NULL;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients" DROP CONSTRAINT IF EXISTS "manufacturing_order_ingredients_lot_strategy_check";--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_order_ingredients" ADD CONSTRAINT "manufacturing_order_ingredients_lot_strategy_check" CHECK (lot_strategy IN ('fifo','lifo','custom'));
