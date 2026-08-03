UPDATE "system"."organization"
SET "plan" = 'free'
WHERE "plan" IN ('core', 'pro')
  AND "stripe_subscription_id" IS NULL;
