CREATE SEQUENCE IF NOT EXISTS "purchasing"."order_number_seq";
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "purchasing"."order_number_seq" TO app_user;
