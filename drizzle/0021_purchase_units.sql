ALTER TABLE "inventory"."items"
  ADD COLUMN "purchase_unit_definition_id" uuid,
  ADD COLUMN "purchase_to_stock_factor" numeric(12, 4);
--> statement-breakpoint
ALTER TABLE "inventory"."items"
  ADD CONSTRAINT "items_purchase_unit_definition_id_unit_definitions_id_fk"
  FOREIGN KEY ("purchase_unit_definition_id")
  REFERENCES "inventory"."unit_definitions"("id")
  ON DELETE no action
  ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines"
  RENAME COLUMN "unit_name" TO "purchase_unit_name";
--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines"
  ADD COLUMN "stocking_unit_name" varchar(50),
  ADD COLUMN "purchase_to_stock_factor" numeric(12, 4),
  ADD COLUMN "stock_quantity_ordered" numeric(12, 4),
  ADD COLUMN "stock_quantity_received" numeric(12, 4),
  ADD COLUMN "stock_unit_cost" numeric(10, 4);
--> statement-breakpoint
UPDATE "purchasing"."purchase_order_lines"
SET
  "stocking_unit_name" = "purchase_unit_name",
  "purchase_to_stock_factor" = 1,
  "stock_quantity_ordered" = "quantity_ordered",
  "stock_quantity_received" = "quantity_received",
  "stock_unit_cost" = "unit_cost";
--> statement-breakpoint
ALTER TABLE "purchasing"."purchase_order_lines"
  ALTER COLUMN "purchase_unit_name" SET NOT NULL,
  ALTER COLUMN "stocking_unit_name" SET NOT NULL,
  ALTER COLUMN "purchase_to_stock_factor" SET NOT NULL,
  ALTER COLUMN "purchase_to_stock_factor" SET DEFAULT 1,
  ALTER COLUMN "stock_quantity_ordered" SET NOT NULL,
  ALTER COLUMN "stock_quantity_received" SET NOT NULL,
  ALTER COLUMN "stock_quantity_received" SET DEFAULT 0,
  ALTER COLUMN "stock_unit_cost" SET NOT NULL;
