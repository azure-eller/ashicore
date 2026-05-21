ALTER TABLE "sales"."sales_orders"
  ADD COLUMN IF NOT EXISTS "billing_line1" varchar(255),
  ADD COLUMN IF NOT EXISTS "billing_line2" varchar(255),
  ADD COLUMN IF NOT EXISTS "billing_city" varchar(120),
  ADD COLUMN IF NOT EXISTS "billing_region" varchar(120),
  ADD COLUMN IF NOT EXISTS "billing_postcode" varchar(30),
  ADD COLUMN IF NOT EXISTS "billing_country" varchar(120);
