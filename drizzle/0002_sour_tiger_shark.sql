ALTER TABLE "inventory"."unit_definitions" ALTER COLUMN "organization_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "inventory"."items" ALTER COLUMN "organization_id" SET DATA TYPE text;