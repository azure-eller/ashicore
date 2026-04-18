ALTER TABLE "inventory"."stock_movements" DROP COLUMN IF EXISTS "reason";--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" DROP COLUMN IF EXISTS "cost_per_unit";--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" DROP COLUMN IF EXISTS "notes";