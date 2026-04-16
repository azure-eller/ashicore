ALTER TABLE "sales"."customers" ADD COLUMN IF NOT EXISTS "billing_line1" varchar(255);--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN IF NOT EXISTS "billing_line2" varchar(255);--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN IF NOT EXISTS "billing_city" varchar(120);--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN IF NOT EXISTS "billing_region" varchar(120);--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN IF NOT EXISTS "billing_postcode" varchar(30);--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN IF NOT EXISTS "billing_country" varchar(120);--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN IF NOT EXISTS "ship_line1" varchar(255);--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN IF NOT EXISTS "ship_line2" varchar(255);--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN IF NOT EXISTS "ship_city" varchar(120);--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN IF NOT EXISTS "ship_region" varchar(120);--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN IF NOT EXISTS "ship_postcode" varchar(30);--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD COLUMN IF NOT EXISTS "ship_country" varchar(120);--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" ADD COLUMN IF NOT EXISTS "billing_line1" varchar(255);--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" ADD COLUMN IF NOT EXISTS "billing_line2" varchar(255);--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" ADD COLUMN IF NOT EXISTS "billing_city" varchar(120);--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" ADD COLUMN IF NOT EXISTS "billing_region" varchar(120);--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" ADD COLUMN IF NOT EXISTS "billing_postcode" varchar(30);--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" ADD COLUMN IF NOT EXISTS "billing_country" varchar(120);--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'sales' AND table_name = 'customers' AND column_name = 'address'
  ) THEN
    UPDATE "sales"."customers" SET "billing_line1" = LEFT("address", 255) WHERE "address" IS NOT NULL AND "billing_line1" IS NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'purchasing' AND table_name = 'suppliers' AND column_name = 'address'
  ) THEN
    UPDATE "purchasing"."suppliers" SET "billing_line1" = LEFT("address", 255) WHERE "address" IS NOT NULL AND "billing_line1" IS NULL;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "sales"."customers" DROP COLUMN IF EXISTS "address";--> statement-breakpoint
ALTER TABLE "purchasing"."suppliers" DROP COLUMN IF EXISTS "address";
