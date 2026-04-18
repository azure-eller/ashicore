ALTER TABLE "inventory"."items" ADD COLUMN IF NOT EXISTS "variant_axes" jsonb;--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD COLUMN IF NOT EXISTS "variant_attrs" jsonb;--> statement-breakpoint
ALTER TABLE "inventory"."items" DROP COLUMN IF EXISTS "bom_inherited";--> statement-breakpoint
ALTER TABLE "inventory"."items" ALTER COLUMN "unit_definition_id" DROP NOT NULL;--> statement-breakpoint ALTER TABLE "inventory"."items" DROP CONSTRAINT IF EXISTS "items_non_master_needs_unit";--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD CONSTRAINT "items_non_master_needs_unit" CHECK (is_master = true OR unit_definition_id IS NOT NULL);--> statement-breakpoint ALTER TABLE "inventory"."items" DROP CONSTRAINT IF EXISTS "items_variant_attrs_needs_parent";--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD CONSTRAINT "items_variant_attrs_needs_parent" CHECK (variant_attrs IS NULL OR parent_id IS NOT NULL);--> statement-breakpoint ALTER TABLE "inventory"."items" DROP CONSTRAINT IF EXISTS "items_variant_axes_needs_master";--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD CONSTRAINT "items_variant_axes_needs_master" CHECK (variant_axes IS NULL OR is_master = true);
