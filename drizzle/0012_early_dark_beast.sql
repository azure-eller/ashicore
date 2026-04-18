ALTER TABLE "inventory"."items" DROP COLUMN IF EXISTS "bom_mode";--> statement-breakpoint
ALTER TABLE "inventory"."bom_components" DROP COLUMN IF EXISTS "percentage";