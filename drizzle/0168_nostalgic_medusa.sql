ALTER TABLE "system"."organization" DROP CONSTRAINT IF EXISTS "organization_plan_check";--> statement-breakpoint
ALTER TABLE "system"."organization" ALTER COLUMN "plan" SET DEFAULT 'trial';--> statement-breakpoint
ALTER TABLE "system"."organization" ADD COLUMN IF NOT EXISTS "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "system"."organization" ADD COLUMN IF NOT EXISTS "billing_interval" varchar(20) DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "system"."organization" ADD COLUMN IF NOT EXISTS "sales_order_band" varchar(20) DEFAULT 'starter' NOT NULL;--> statement-breakpoint
ALTER TABLE "system"."organization" ADD COLUMN IF NOT EXISTS "location_capacity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "system"."organization" ADD COLUMN IF NOT EXISTS "billing_addons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint ALTER TABLE "system"."organization" DROP CONSTRAINT IF EXISTS "organization_billing_interval_check";--> statement-breakpoint
ALTER TABLE "system"."organization" ADD CONSTRAINT "organization_billing_interval_check" CHECK (billing_interval IN ('monthly', 'annual'));--> statement-breakpoint ALTER TABLE "system"."organization" DROP CONSTRAINT IF EXISTS "organization_sales_order_band_check";--> statement-breakpoint
ALTER TABLE "system"."organization" ADD CONSTRAINT "organization_sales_order_band_check" CHECK (sales_order_band IN ('starter', 'growth', 'pro', 'scale'));--> statement-breakpoint ALTER TABLE "system"."organization" DROP CONSTRAINT IF EXISTS "organization_location_capacity_positive_check";--> statement-breakpoint
ALTER TABLE "system"."organization" ADD CONSTRAINT "organization_location_capacity_positive_check" CHECK (location_capacity >= 1);--> statement-breakpoint ALTER TABLE "system"."organization" DROP CONSTRAINT IF EXISTS "organization_plan_check";--> statement-breakpoint
ALTER TABLE "system"."organization" ADD CONSTRAINT "organization_plan_check" CHECK (plan IN ('trial', 'free', 'core'));
