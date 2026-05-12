ALTER TABLE "inventory"."stock_allocations"
  DROP CONSTRAINT IF EXISTS "stock_allocations_demand_type_check";
--> statement-breakpoint
ALTER TABLE "inventory"."stock_allocations"
  ADD CONSTRAINT "stock_allocations_demand_type_check"
  CHECK ("demand_type" IN ('sales_order_line', 'manufacturing_order_ingredient'));
