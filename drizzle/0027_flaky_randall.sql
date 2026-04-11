ALTER TABLE "inventory"."stocktakes" ALTER COLUMN "scope" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "inventory"."stocktakes" ALTER COLUMN "scope" SET DEFAULT 'all';--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD COLUMN "is_master" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD COLUMN "bom_inherited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory"."bom_revisions" ADD COLUMN "parent_bom_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD CONSTRAINT "items_parent_id_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "inventory"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory"."bom_revisions" ADD CONSTRAINT "bom_revisions_parent_bom_revision_id_bom_revisions_id_fk" FOREIGN KEY ("parent_bom_revision_id") REFERENCES "inventory"."bom_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_parent_id_idx" ON "inventory"."items" USING btree ("parent_id") WHERE parent_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD CONSTRAINT "items_no_self_parent" CHECK (parent_id != id);--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD CONSTRAINT "items_products_only_variants" CHECK (parent_id IS NULL OR item_type = 'product');--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD CONSTRAINT "items_products_only_masters" CHECK (is_master = false OR item_type = 'product');--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD CONSTRAINT "items_variants_not_masters" CHECK (parent_id IS NULL OR is_master = false);