ALTER TABLE "sales"."customer_contacts" ADD COLUMN IF NOT EXISTS "address_entry_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales"."customer_contacts" ADD CONSTRAINT "customer_contacts_address_entry_id_entries_id_fk" FOREIGN KEY ("address_entry_id") REFERENCES "addresses"."entries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_customer_contacts_address_entry_id_idx" ON "sales"."customer_contacts" USING btree ("address_entry_id");
