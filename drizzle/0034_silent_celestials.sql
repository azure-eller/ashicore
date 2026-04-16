ALTER TABLE "inventory"."items" ADD COLUMN "sellable" boolean;--> statement-breakpoint
UPDATE "inventory"."items"
SET "sellable" = true
WHERE "is_master" = false;--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD CONSTRAINT "items_master_sellable_must_be_null" CHECK (is_master = false OR sellable IS NULL);--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD CONSTRAINT "items_non_master_sellable_required" CHECK (is_master = true OR sellable IS NOT NULL);
