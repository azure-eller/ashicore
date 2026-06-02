ALTER TABLE "system"."organization" ADD COLUMN IF NOT EXISTS "plan" varchar(20) DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "system"."organization" ADD COLUMN IF NOT EXISTS "status" varchar(20) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "system"."organization" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "system"."organization" ADD COLUMN IF NOT EXISTS "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "system"."organization" ADD COLUMN IF NOT EXISTS "current_period_end" timestamp with time zone;--> statement-breakpoint
UPDATE "system"."organization"
SET "plan" = 'core', "status" = 'active'
WHERE "slug" IN ('paonia-soil-co', 'paonia', 'test-paonia-soil-co')
   OR "name" ILIKE 'Paonia Soil Co%';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_stripe_customer_id_uidx" ON "system"."organization" USING btree ("stripe_customer_id") WHERE stripe_customer_id IS NOT NULL;--> statement-breakpoint ALTER TABLE "system"."organization" DROP CONSTRAINT IF EXISTS "organization_plan_check";--> statement-breakpoint
ALTER TABLE "system"."organization" ADD CONSTRAINT "organization_plan_check" CHECK (plan IN ('free', 'core'));--> statement-breakpoint ALTER TABLE "system"."organization" DROP CONSTRAINT IF EXISTS "organization_status_check";--> statement-breakpoint
ALTER TABLE "system"."organization" ADD CONSTRAINT "organization_status_check" CHECK (status IN ('active', 'past_due', 'canceled'));
