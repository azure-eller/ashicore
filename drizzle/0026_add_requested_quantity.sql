ALTER TABLE "manufacturing"."manufacturing_orders"
ADD COLUMN IF NOT EXISTS "requested_quantity" numeric(12, 4);--> statement-breakpoint
UPDATE "manufacturing"."manufacturing_orders"
SET "requested_quantity" = "planned_quantity"
WHERE "requested_quantity" IS NULL;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_orders"
ALTER COLUMN "requested_quantity" SET NOT NULL;
