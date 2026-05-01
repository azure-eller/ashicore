ALTER TABLE "inventory"."lots" ALTER COLUMN "lot_number" SET DATA TYPE varchar(128);--> statement-breakpoint
ALTER TABLE "inventory"."items" DROP COLUMN IF EXISTS "reorder_point";--> statement-breakpoint
ALTER TABLE "inventory"."items" DROP COLUMN IF EXISTS "target_cover_days";--> statement-breakpoint
ALTER TABLE "inventory"."items" DROP COLUMN IF EXISTS "planning_enabled";--> statement-breakpoint
ALTER TABLE "inventory"."items" DROP COLUMN IF EXISTS "lead_time_days_override";--> statement-breakpoint
ALTER TABLE "inventory"."items" DROP COLUMN IF EXISTS "production_lead_time_days";--> statement-breakpoint
ALTER TABLE "purchasing"."supplier_items" DROP COLUMN IF EXISTS "lead_time_days_override";--> statement-breakpoint
ALTER TABLE "purchasing"."supplier_items" DROP COLUMN IF EXISTS "minimum_order_quantity";--> statement-breakpoint
ALTER TABLE "purchasing"."supplier_items" DROP COLUMN IF EXISTS "order_multiple";