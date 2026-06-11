ALTER TABLE "reporting"."notification_preferences" DROP CONSTRAINT IF EXISTS "notification_preferences_event_type_check";--> statement-breakpoint
ALTER TABLE "reporting"."notification_preferences" ADD CONSTRAINT "notification_preferences_event_type_check" CHECK ("reporting"."notification_preferences"."event_type" IN ('manufacturing_order_created', 'manufacturing_order_completed', 'purchase_order_received'));--> statement-breakpoint
ALTER TABLE "reporting"."notifications" DROP CONSTRAINT IF EXISTS "notifications_type_check";--> statement-breakpoint
ALTER TABLE "reporting"."notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("reporting"."notifications"."type" IN ('daily_manufacturing_report', 'manufacturing_order_created', 'manufacturing_order_completed', 'purchase_order_received'));--> statement-breakpoint
ALTER TABLE "reporting"."notifications" DROP CONSTRAINT IF EXISTS "notifications_entity_type_check";--> statement-breakpoint
ALTER TABLE "reporting"."notifications" ADD CONSTRAINT "notifications_entity_type_check" CHECK ("reporting"."notifications"."entity_type" IN ('report_run', 'manufacturing_order', 'purchase_order'));
