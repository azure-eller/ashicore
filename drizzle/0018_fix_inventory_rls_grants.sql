-- Fix: Add FORCE ROW LEVEL SECURITY and app_user grants for original
-- inventory tables that were missing from early migrations (0003-0009).
-- All newer schemas (sales, manufacturing, purchasing, stocktakes) already
-- have both. This brings the original tables to parity.

-- 1. FORCE RLS on the 5 original inventory tables
ALTER TABLE "inventory"."unit_definitions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."lots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."bom_components" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- 2. Schema-level access
GRANT USAGE ON SCHEMA "inventory" TO app_user;--> statement-breakpoint

-- 3. Table-level CRUD for app_user
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."unit_definitions" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."items" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."lots" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."bom_components" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."stock_movements" TO app_user;--> statement-breakpoint

-- 4. Sequence access for lot number generation
GRANT USAGE, SELECT ON SEQUENCE "inventory"."lot_number_seq" TO app_user;
