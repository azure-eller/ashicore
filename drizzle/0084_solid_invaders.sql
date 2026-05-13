ALTER TABLE "purchasing"."purchase_order_lines" ADD COLUMN IF NOT EXISTS "ship_line1" varchar(255);--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines" ADD COLUMN IF NOT EXISTS "ship_line2" varchar(255);--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines" ADD COLUMN IF NOT EXISTS "ship_city" varchar(120);--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines" ADD COLUMN IF NOT EXISTS "ship_region" varchar(120);--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines" ADD COLUMN IF NOT EXISTS "ship_postcode" varchar(30);--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines" ADD COLUMN IF NOT EXISTS "ship_country" varchar(120);--> statement-breakpoint
UPDATE "purchasing"."purchase_order_lines" AS pol
SET
  "ship_line1" = COALESCE(pol."ship_line1", po."ship_line1"),
  "ship_line2" = COALESCE(pol."ship_line2", po."ship_line2"),
  "ship_city" = COALESCE(pol."ship_city", po."ship_city"),
  "ship_region" = COALESCE(pol."ship_region", po."ship_region"),
  "ship_postcode" = COALESCE(pol."ship_postcode", po."ship_postcode"),
  "ship_country" = COALESCE(pol."ship_country", po."ship_country")
FROM "purchasing"."purchase_orders" AS po
WHERE pol."purchase_order_id" = po."id"
  AND (
    po."ship_line1" IS NOT NULL
    OR po."ship_line2" IS NOT NULL
    OR po."ship_city" IS NOT NULL
    OR po."ship_region" IS NOT NULL
    OR po."ship_postcode" IS NOT NULL
    OR po."ship_country" IS NOT NULL
  );
