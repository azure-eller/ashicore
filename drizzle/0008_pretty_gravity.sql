CREATE TABLE "inventory"."lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"lot_number" varchar(20) NOT NULL,
	"quantity" numeric(12, 4) DEFAULT '0' NOT NULL,
	"cost_per_unit" numeric(10, 4),
	"received_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory"."lots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory"."lots" ADD CONSTRAINT "lots_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "inventory"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lots_org_lot_number_uidx" ON "inventory"."lots" USING btree ("organization_id","lot_number");--> statement-breakpoint
CREATE INDEX "lots_item_id_idx" ON "inventory"."lots" USING btree ("item_id");--> statement-breakpoint
INSERT INTO "inventory"."lots" (id, organization_id, item_id, lot_number, quantity, cost_per_unit, received_at)
SELECT
  gen_random_uuid(),
  organization_id,
  id,
  'LOT-' || LPAD(ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY created_at)::text, 6, '0'),
  in_stock,
  default_purchase_price,
  created_at
FROM "inventory"."items"
WHERE in_stock > 0 AND deleted_at IS NULL;--> statement-breakpoint
ALTER TABLE "inventory"."items" DROP COLUMN "in_stock";--> statement-breakpoint
CREATE POLICY "lots_org_isolation" ON "inventory"."lots" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));