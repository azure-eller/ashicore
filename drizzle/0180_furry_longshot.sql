ALTER TABLE "system"."organization" DROP CONSTRAINT IF EXISTS "organization_plan_check";--> statement-breakpoint
ALTER TABLE "system"."organization" ALTER COLUMN "plan" SET DEFAULT 'free';--> statement-breakpoint
ALTER TABLE "system"."organization" ADD COLUMN IF NOT EXISTS "sku_limit_starts_at" timestamp with time zone DEFAULT now() + interval '15 days' NOT NULL;--> statement-breakpoint
ALTER TABLE "system"."organization" ADD COLUMN IF NOT EXISTS "beta_features" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "system"."organization"
SET "beta_features" = CASE
  WHEN "entitlements" @> '["pricing_scenarios"]'::jsonb THEN '["pricing_scenarios"]'::jsonb
  ELSE '[]'::jsonb
END;--> statement-breakpoint
ALTER TABLE "system"."organization" DROP CONSTRAINT IF EXISTS "organization_plan_check";--> statement-breakpoint
ALTER TABLE "system"."organization" ADD CONSTRAINT "organization_plan_check" CHECK (plan IN ('trial', 'free', 'core', 'pro'));
