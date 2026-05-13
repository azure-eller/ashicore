ALTER TABLE "inventory"."stock_allocations"
  DROP CONSTRAINT IF EXISTS "stock_allocations_source_type_check";
--> statement-breakpoint
ALTER TABLE "inventory"."stock_allocations"
  DROP CONSTRAINT IF EXISTS "stock_allocations_source_id_check";
--> statement-breakpoint
DROP INDEX IF EXISTS "inventory"."stock_allocations_active_stock_pool_uidx";
--> statement-breakpoint
DROP INDEX IF EXISTS "inventory"."stock_allocations_active_source_uidx";
--> statement-breakpoint

UPDATE "inventory"."stock_allocations"
SET "source_type" = 'inventory_lot'
WHERE "source_type" = 'lot';
--> statement-breakpoint

DO $$
DECLARE
  pool_row RECORD;
  lot_row RECORD;
  remaining numeric;
  take_qty numeric;
  existing_allocation_id uuid;
BEGIN
  FOR pool_row IN
    SELECT *
    FROM "inventory"."stock_allocations"
    WHERE "source_type" = 'stock_pool'
      AND "status" = 'active'
    ORDER BY "organization_id", "item_id", "created_at", "id"
  LOOP
    remaining := pool_row."quantity";

    FOR lot_row IN
      SELECT
        b."lot_id",
        b."quantity"
          - COALESCE((
              SELECT SUM(a."quantity")
              FROM "inventory"."stock_allocations" a
              WHERE a."organization_id" = b."organization_id"
                AND a."item_id" = b."item_id"
                AND a."source_type" = 'inventory_lot'
                AND a."source_id" = b."lot_id"
                AND a."status" = 'active'
            ), 0) AS free_qty
      FROM "inventory"."inventory_lot_balances" b
      INNER JOIN "inventory"."lots" l ON l."id" = b."lot_id"
      WHERE b."organization_id" = pool_row."organization_id"
        AND b."item_id" = pool_row."item_id"
        AND b."disposition" = 'available'
        AND b."quantity" > 0
      ORDER BY b."received_at", l."created_at", l."lot_number", b."lot_id"
    LOOP
      EXIT WHEN remaining <= 0;
      IF lot_row.free_qty <= 0 THEN
        CONTINUE;
      END IF;

      take_qty := LEAST(remaining, lot_row.free_qty);

      SELECT a."id"
      INTO existing_allocation_id
      FROM "inventory"."stock_allocations" a
      WHERE a."organization_id" = pool_row."organization_id"
        AND a."demand_type" = pool_row."demand_type"
        AND a."demand_id" = pool_row."demand_id"
        AND a."source_type" = 'inventory_lot'
        AND a."source_id" = lot_row."lot_id"
        AND a."status" = 'active'
      FOR UPDATE;

      IF existing_allocation_id IS NOT NULL THEN
        UPDATE "inventory"."stock_allocations"
        SET
          "quantity" = "quantity" + take_qty,
          "updated_by" = COALESCE(pool_row."updated_by", "updated_by"),
          "updated_at" = now()
        WHERE "id" = existing_allocation_id;
      ELSE

        INSERT INTO "inventory"."stock_allocations" (
          "organization_id",
          "demand_type",
          "demand_id",
          "item_id",
          "source_type",
          "source_id",
          "quantity",
          "status",
          "demand_label_snapshot",
          "source_label_snapshot",
          "notes",
          "created_by",
          "updated_by",
          "created_at",
          "updated_at"
        )
        VALUES (
          pool_row."organization_id",
          pool_row."demand_type",
          pool_row."demand_id",
          pool_row."item_id",
          'inventory_lot',
          lot_row."lot_id",
          take_qty,
          'active',
          pool_row."demand_label_snapshot",
          'Migrated from stock pool',
          pool_row."notes",
          pool_row."created_by",
          pool_row."updated_by",
          pool_row."created_at",
          now()
        );
      END IF;

      remaining := remaining - take_qty;
      existing_allocation_id := NULL;
    END LOOP;

    IF remaining > 0.00005 THEN
      RAISE EXCEPTION
        'Cannot migrate stock_pool allocation %. Missing % available lot quantity for item % demand %:%.',
        pool_row."id",
        remaining,
        pool_row."item_id",
        pool_row."demand_type",
        pool_row."demand_id";
    END IF;

    UPDATE "inventory"."stock_allocations"
    SET
      "status" = 'cancelled',
      "cancelled_at" = now(),
      "cancelled_by" = COALESCE(pool_row."updated_by", pool_row."created_by"),
      "updated_at" = now()
    WHERE "id" = pool_row."id";
  END LOOP;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "inventory"."stock_allocations"
    WHERE "source_type" IN ('stock_pool', 'lot')
      AND "status" = 'active'
  ) THEN
    RAISE EXCEPTION 'stock_allocations still contains active legacy source types.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "inventory"."stock_allocations"
    WHERE "status" = 'active'
      AND "source_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'stock_allocations still contains active rows with null source_id.';
  END IF;
END $$;
--> statement-breakpoint

DELETE FROM "inventory"."stock_allocations"
WHERE "source_type" = 'stock_pool'
  AND "status" <> 'active';
--> statement-breakpoint

ALTER TABLE "inventory"."stock_allocations"
  ALTER COLUMN "source_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory"."stock_allocations"
  ADD CONSTRAINT "stock_allocations_source_type_check"
  CHECK ("source_type" IN ('inventory_lot', 'manufacturing_order'));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_allocations_active_source_uidx"
  ON "inventory"."stock_allocations" USING btree (
    "organization_id",
    "demand_type",
    "demand_id",
    "source_type",
    "source_id"
  )
  WHERE "status" = 'active';
--> statement-breakpoint
DROP TABLE IF EXISTS "sales"."sales_order_allocations";
