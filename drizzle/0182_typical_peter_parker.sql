ALTER TABLE "inventory"."item_families" ADD COLUMN IF NOT EXISTS "sales_unit_definition_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory"."item_families" ADD COLUMN IF NOT EXISTS "sales_to_stock_factor" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD COLUMN IF NOT EXISTS "sales_unit_definition_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD COLUMN IF NOT EXISTS "sales_to_stock_factor" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD COLUMN IF NOT EXISTS "stocking_unit_name" varchar(50);--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD COLUMN IF NOT EXISTS "sales_to_stock_factor" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD COLUMN IF NOT EXISTS "stock_quantity" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD COLUMN IF NOT EXISTS "stock_cancelled_quantity" numeric(12, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD COLUMN IF NOT EXISTS "stock_shipped_quantity" numeric(12, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
UPDATE "sales"."sales_order_lines"
SET
  "stocking_unit_name" = "unit_name",
  "sales_to_stock_factor" = 1,
  "stock_quantity" = "quantity",
  "stock_cancelled_quantity" = "cancelled_quantity",
  "stock_shipped_quantity" = "shipped_quantity"
WHERE
  "stocking_unit_name" IS NULL
  OR "sales_to_stock_factor" IS NULL
  OR "stock_quantity" IS NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "sales"."populate_sales_order_line_stock_snapshot"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."stocking_unit_name" IS NULL
      OR NEW."sales_to_stock_factor" IS NULL
      OR NEW."stock_quantity" IS NULL THEN
      NEW."stocking_unit_name" := NEW."unit_name";
      NEW."sales_to_stock_factor" := 1;
      NEW."stock_quantity" := NEW."quantity";
      NEW."stock_cancelled_quantity" := NEW."cancelled_quantity";
      NEW."stock_shipped_quantity" := NEW."shipped_quantity";
    END IF;
  ELSE
    IF NEW."quantity" IS DISTINCT FROM OLD."quantity"
      AND NEW."stock_quantity" IS NOT DISTINCT FROM OLD."stock_quantity" THEN
      IF NEW."sales_to_stock_factor" <> 1 THEN
        RAISE EXCEPTION 'Legacy sales-order line mutations are not supported for converted sales units';
      END IF;
      NEW."stock_quantity" := NEW."quantity";
    END IF;
    IF NEW."cancelled_quantity" IS DISTINCT FROM OLD."cancelled_quantity"
      AND NEW."stock_cancelled_quantity" IS NOT DISTINCT FROM OLD."stock_cancelled_quantity" THEN
      IF NEW."sales_to_stock_factor" <> 1 THEN
        RAISE EXCEPTION 'Legacy sales-order line mutations are not supported for converted sales units';
      END IF;
      NEW."stock_cancelled_quantity" := NEW."cancelled_quantity";
    END IF;
    IF NEW."shipped_quantity" IS DISTINCT FROM OLD."shipped_quantity"
      AND NEW."stock_shipped_quantity" IS NOT DISTINCT FROM OLD."stock_shipped_quantity" THEN
      IF NEW."sales_to_stock_factor" <> 1 THEN
        RAISE EXCEPTION 'Legacy sales-order line mutations are not supported for converted sales units';
      END IF;
      NEW."stock_shipped_quantity" := NEW."shipped_quantity";
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "sales_order_lines_stock_snapshot_compat" ON "sales"."sales_order_lines";--> statement-breakpoint
CREATE TRIGGER "sales_order_lines_stock_snapshot_compat"
BEFORE INSERT OR UPDATE ON "sales"."sales_order_lines"
FOR EACH ROW
EXECUTE FUNCTION "sales"."populate_sales_order_line_stock_snapshot"();--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ALTER COLUMN "stocking_unit_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ALTER COLUMN "sales_to_stock_factor" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ALTER COLUMN "stock_quantity" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory"."item_families" DROP CONSTRAINT IF EXISTS "item_families_sales_unit_definition_id_unit_definitions_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."item_families" ADD CONSTRAINT "item_families_sales_unit_definition_id_unit_definitions_id_fk" FOREIGN KEY ("sales_unit_definition_id") REFERENCES "inventory"."unit_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."items" DROP CONSTRAINT IF EXISTS "items_sales_unit_definition_id_unit_definitions_id_fk";--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD CONSTRAINT "items_sales_unit_definition_id_unit_definitions_id_fk" FOREIGN KEY ("sales_unit_definition_id") REFERENCES "inventory"."unit_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint ALTER TABLE "inventory"."item_families" DROP CONSTRAINT IF EXISTS "item_families_sales_unit_pair_check";--> statement-breakpoint
ALTER TABLE "inventory"."item_families" ADD CONSTRAINT "item_families_sales_unit_pair_check" CHECK ((sales_unit_definition_id IS NULL AND sales_to_stock_factor IS NULL)
          OR (
            sales_unit_definition_id IS NOT NULL
            AND sales_to_stock_factor IS NOT NULL
            AND sales_to_stock_factor > 0
            AND sales_unit_definition_id <> unit_definition_id
          ));--> statement-breakpoint ALTER TABLE "inventory"."items" DROP CONSTRAINT IF EXISTS "items_sales_unit_pair_check";--> statement-breakpoint
ALTER TABLE "inventory"."items" ADD CONSTRAINT "items_sales_unit_pair_check" CHECK ((sales_unit_definition_id IS NULL AND sales_to_stock_factor IS NULL)
          OR (
            sales_unit_definition_id IS NOT NULL
            AND sales_to_stock_factor IS NOT NULL
            AND sales_to_stock_factor > 0
            AND unit_definition_id IS NOT NULL
            AND sales_unit_definition_id <> unit_definition_id
          ));--> statement-breakpoint ALTER TABLE "sales"."sales_order_lines" DROP CONSTRAINT IF EXISTS "sales_order_lines_stock_quantity_check";--> statement-breakpoint
ALTER TABLE "sales"."sales_order_lines" ADD CONSTRAINT "sales_order_lines_stock_quantity_check" CHECK (sales_to_stock_factor > 0
          AND stock_quantity > 0
          AND stock_cancelled_quantity >= 0
          AND stock_shipped_quantity >= 0
          AND stock_cancelled_quantity + stock_shipped_quantity <= stock_quantity);
