ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT "inventory_events_event_type_check";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT "inventory_events_quantity_check";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT IF EXISTS "inventory_events_landed_cost_revaluation_check";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" ADD CONSTRAINT "inventory_events_landed_cost_revaluation_check" CHECK (event_type <> 'landed_cost_revaluation' OR (lot_id IS NOT NULL AND unit_cost IS NOT NULL AND extended_cost IS NOT NULL AND reference_type = 'purchase_order'));--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT IF EXISTS "inventory_events_event_type_check";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" ADD CONSTRAINT "inventory_events_event_type_check" CHECK (event_type IN ('opening_balance', 'purchase_receipt', 'manufacturing_output', 'manual_adjustment_increase', 'stocktake_gain', 'manufacturing_variance_gain', 'manual_adjustment_decrease', 'stocktake_loss', 'sales_consumption', 'manufacturing_ingredient_consumption', 'manufacturing_variance_loss', 'quality_scrap', 'unpick_restock', 'quality_disposition_change', 'reservation_increase', 'reservation_release', 'demand_increase', 'demand_release', 'expected_increase', 'expected_release', 'cost_basis_change', 'landed_cost_revaluation', 'stocktake_verification'));--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" DROP CONSTRAINT IF EXISTS "inventory_events_quantity_check";--> statement-breakpoint
ALTER TABLE "inventory"."inventory_events" ADD CONSTRAINT "inventory_events_quantity_check" CHECK (CASE
          WHEN event_type IN ('stocktake_verification', 'cost_basis_change', 'landed_cost_revaluation') THEN quantity = 0
          ELSE quantity > 0
        END);
