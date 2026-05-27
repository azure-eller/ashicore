ALTER TABLE "inventory"."item_families"
  ADD COLUMN IF NOT EXISTS "lot_tracking_mode" varchar(20) DEFAULT 'tracked' NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'item_families_lot_tracking_mode_check'
  ) THEN
    ALTER TABLE "inventory"."item_families"
      ADD CONSTRAINT "item_families_lot_tracking_mode_check"
      CHECK ("lot_tracking_mode" IN ('tracked', 'untracked'));
  END IF;
END $$;
