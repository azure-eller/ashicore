ALTER TABLE "sales"."customers" ADD COLUMN "billing_line1" varchar(255);--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN "billing_line2" varchar(255);--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN "billing_city" varchar(120);--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN "billing_region" varchar(120);--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN "billing_postcode" varchar(30);--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN "billing_country" varchar(120);--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN "ship_line1" varchar(255);--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN "ship_line2" varchar(255);--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN "ship_city" varchar(120);--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN "ship_region" varchar(120);--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN "ship_postcode" varchar(30);--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN "ship_country" varchar(120);--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" ADD COLUMN "billing_line1" varchar(255);--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" ADD COLUMN "billing_line2" varchar(255);--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" ADD COLUMN "billing_city" varchar(120);--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" ADD COLUMN "billing_region" varchar(120);--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" ADD COLUMN "billing_postcode" varchar(30);--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" ADD COLUMN "billing_country" varchar(120);--> statement-breakpoint
UPDATE "sales"."customers" SET "billing_line1" = LEFT("address", 255) WHERE "address" IS NOT NULL AND "billing_line1" IS NULL;--> statement-breakpoint
UPDATE "purchasing"."suppliers" SET "billing_line1" = LEFT("address", 255) WHERE "address" IS NOT NULL AND "billing_line1" IS NULL;--> statement-breakpoint
ALTER TABLE "sales"."customers" DROP COLUMN "address";--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" DROP COLUMN "address";