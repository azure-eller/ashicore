ALTER TABLE "inventory"."items" ADD COLUMN IF NOT EXISTS "sellable" boolean;--> statement-breakpoint
UPDATE "inventory"."items"
SET "sellable" = true
WHERE "is_master" = false
  AND "sellable" IS NULL;--> statement-breakpoint
DO $$
BEGIN
    ALTER TABLE "inventory"."items" ADD CONSTRAINT "items_master_sellable_must_be_null" CHECK (is_master = false OR sellable IS NULL);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint
DO $$
BEGIN
    ALTER TABLE "inventory"."items" ADD CONSTRAINT "items_non_master_sellable_required" CHECK (is_master = true OR sellable IS NOT NULL);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;
