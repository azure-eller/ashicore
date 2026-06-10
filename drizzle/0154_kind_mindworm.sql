DROP POLICY "sales_customer_correspondence_org_isolation" ON "sales"."customer_correspondence" CASCADE;--> statement-breakpoint
DROP TABLE "sales"."customer_correspondence" CASCADE;--> statement-breakpoint
DROP POLICY "sales_customer_correspondence_attendees_org_isolation" ON "sales"."customer_correspondence_attendees" CASCADE;--> statement-breakpoint
DROP TABLE "sales"."customer_correspondence_attendees" CASCADE;