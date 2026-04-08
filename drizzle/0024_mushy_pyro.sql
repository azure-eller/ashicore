ALTER TABLE "inventory"."stocktakes" ALTER COLUMN "scope" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "inventory"."stocktakes" ALTER COLUMN "scope" SET DEFAULT 'all';