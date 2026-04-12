ALTER TABLE "inventory"."unit_definitions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."lots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."bom_components" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT USAGE ON SCHEMA "inventory" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."unit_definitions" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."items" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."lots" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."bom_components" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."stock_movements" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."stocktakes" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."stocktake_items" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."bom_revisions" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "inventory"."bom_revision_components" TO app_user;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "inventory"."lot_number_seq" TO app_user;
