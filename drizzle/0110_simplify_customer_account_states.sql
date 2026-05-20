UPDATE "sales"."customers"
SET "account_state" = CASE
  WHEN "account_state" = 'onboarding' THEN 'active'
  WHEN "account_state" = 'dormant' THEN 'former'
  ELSE "account_state"
END
WHERE "account_state" IN ('onboarding', 'dormant');--> statement-breakpoint
ALTER TABLE "sales"."customers" DROP CONSTRAINT IF EXISTS "sales_customers_account_state_check";--> statement-breakpoint
ALTER TABLE "sales"."customers" ADD CONSTRAINT "sales_customers_account_state_check" CHECK ("sales"."customers"."account_state" IN ('active', 'growth', 'at_risk', 'former'));
