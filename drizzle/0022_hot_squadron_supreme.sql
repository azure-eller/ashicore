ALTER TABLE "inventory"."items" ADD COLUMN "bom_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD COLUMN "bom_locked_at" timestamp;--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD COLUMN "bom_locked_by_user_id" text;