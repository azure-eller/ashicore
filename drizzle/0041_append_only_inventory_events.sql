ALTER TABLE "inventory"."locations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory"."inventory_expected_summary" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory"."inventory_item_balances" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory"."inventory_lot_balances" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory"."inventory_reservations_summary" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory"."inventory_idempotency_claims" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "inventory" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."locations" TO app_user;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "inventory"."inventory_events" FROM "app_user";
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "inventory"."inventory_events" TO "app_user";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."inventory_expected_summary" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."inventory_item_balances" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."inventory_lot_balances" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."inventory_reservations_summary" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."inventory_idempotency_claims" TO app_user;
-- Custom SQL migration file, put your code below! --
