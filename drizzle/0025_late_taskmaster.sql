ALTER TABLE "inventory"."items" ADD COLUMN IF NOT EXISTS "manufacturing_mode" varchar(20) DEFAULT 'discrete' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD COLUMN IF NOT EXISTS "expected_batch_yield" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_orders" ADD COLUMN IF NOT EXISTS "manufacturing_mode" varchar(20) DEFAULT 'discrete' NOT NULL;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_orders" ADD COLUMN IF NOT EXISTS "number_of_batches" integer;--> statement-breakpoint
ALTER TABLE "manufacturing"."manufacturing_orders" ADD COLUMN IF NOT EXISTS "expected_batch_yield" numeric(12, 4);