ALTER TABLE "sales"."sales_orders" ADD COLUMN "ship_line1" varchar(255);--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ADD COLUMN "ship_line2" varchar(255);--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ADD COLUMN "ship_city" varchar(120);--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ADD COLUMN "ship_region" varchar(120);--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ADD COLUMN "ship_postcode" varchar(30);--> statement-breakpoint
ALTER TABLE "sales"."sales_orders" ADD COLUMN "ship_country" varchar(120);