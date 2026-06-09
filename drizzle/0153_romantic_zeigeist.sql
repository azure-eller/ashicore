DELETE FROM "inventory"."inventory_idempotency_claims"
WHERE "operation_name" IN (
  'reserveForSales',
  'releaseReservationForSalesLine',
  'releaseReservationForSalesQuantities',
  'setSalesLineStockReservation',
  'recordSalesDemandAndReservations',
  'releaseIngredientReservationForManufacturing'
);--> statement-breakpoint
UPDATE "inventory"."inventory_idempotency_claims"
SET "first_event_id" = NULL
WHERE "first_event_id" IN (
  SELECT "id"
  FROM "inventory"."inventory_events"
  WHERE "event_type" IN ('reservation_increase', 'reservation_release')
);--> statement-breakpoint
DELETE FROM "inventory"."inventory_events"
WHERE "event_type" IN ('reservation_increase', 'reservation_release');--> statement-breakpoint
DROP POLICY IF EXISTS "inventory_reservations_summary_org_isolation" ON "inventory"."inventory_reservations_summary";--> statement-breakpoint
DROP TABLE IF EXISTS "inventory"."inventory_reservations_summary";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_item_balances" DROP COLUMN IF EXISTS "committed_qty";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_item_balances" DROP COLUMN IF EXISTS "shortage_qty";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT IF EXISTS "inventory_events_event_type_check";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" ADD CONSTRAINT "inventory_events_event_type_check" CHECK (event_type IN ('opening_balance', 'purchase_receipt', 'manufacturing_output', 'manual_adjustment_increase', 'stocktake_gain', 'manufacturing_variance_gain', 'manual_adjustment_decrease', 'stocktake_loss', 'sales_consumption', 'manufacturing_ingredient_consumption', 'manufacturing_variance_loss', 'quality_scrap', 'unpick_restock', 'quality_disposition_change', 'demand_increase', 'demand_release', 'expected_increase', 'expected_release', 'cost_basis_change', 'landed_cost_revaluation', 'stocktake_verification'));--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT IF EXISTS "inventory_events_non_stock_cost_blank_check";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" ADD CONSTRAINT "inventory_events_non_stock_cost_blank_check" CHECK (event_type NOT IN ('demand_increase', 'demand_release', 'expected_increase', 'expected_release', 'cost_basis_change', 'stocktake_verification') OR (lot_id IS NULL AND unit_cost IS NULL AND extended_cost IS NULL));
