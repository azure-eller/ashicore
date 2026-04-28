export const CALCULATED_STOCK_TOOLTIP =
  "Stock - demand + expected - safety stock.";

export const CALCULATED_STOCK_ALERT_TOOLTIP =
  "Below safety stock after demand and expected supply.";

export const AVAILABLE_QTY_TOOLTIP =
  "Stock still available to reserve.";

export const RESERVED_QTY_TOOLTIP =
  "Stock already reserved for demand.";

export const DEMAND_QTY_TOOLTIP =
  "Demand from confirmed sales and released manufacturing orders.";

export const BACKORDER_QTY_TOOLTIP =
  "Demand not covered by reservations.";

export const POTENTIAL_TOOLTIP =
  "Units producible from available ingredient stock.";

export const NOT_SELLABLE_TOOLTIP = "Hidden from sales order pickers.";

export const RESERVATION_STATUS_TOOLTIP = {
  fully: "All demand is reserved.",
  partial: "Some demand is reserved; the rest is backordered.",
  backordered: "No demand is reserved.",
} as const;

export const LOT_DISPOSITION_TOOLTIP =
  "Lot status: available, blocked, rejected, or scrap.";

export const SALES_ORDER_STATUS_TOOLTIP = {
  draft: "Not yet submitted; reserves no stock.",
  confirmed: "Stock reserved; awaiting shipment.",
  shipped: "Stock shipped; order closed.",
  cancelled: "Cancelled; reservations released.",
} as const;

export const SALES_ORDER_STATUS_COLUMN_TOOLTIP =
  "Status values: draft, confirmed, shipped, cancelled.";

export const MANUFACTURING_ORDER_STATUS_TOOLTIP = {
  draft: "Planned but not yet released.",
  released: "Released; ingredients reserved.",
  completed: "Output stocked; order closed.",
  cancelled: "Cancelled; reservations released.",
} as const;

export const MANUFACTURING_ORDER_STATUS_COLUMN_TOOLTIP =
  "Status values: draft, released, completed, cancelled.";

export const PICK_PROGRESS_TOOLTIP = {
  not_started: "No ingredients picked yet.",
  in_progress: "Some ingredients picked; some still open.",
  picked: "All ingredients picked from stock.",
} as const;

export const MANUFACTURING_PLANNED_QTY_TOOLTIP =
  "Output scheduled after batch rounding.";

export const OVERSELL_TOOLTIP_COPY = {
  currentAvailable: "Stock still available to reserve.",
  currentReserved: "Stock already reserved.",
  currentDemand: "Demand before this order.",
  currentShortage: "Unreserved demand before this order.",
  expected: "Inbound supply from open manufacturing and purchase orders.",
  safety: "Stock held back as a buffer.",
  currentCalculated: "Stock - demand + expected - safety stock.",
  projectedDemand: "Demand after confirming this order.",
  projectedShortage: "Unreserved demand after confirming this order.",
  projectedCalculated: "Calculated stock after confirming this order.",
} as const;

export const MANUFACTURING_SHORTAGE_TOOLTIP =
  "Needed minus available.";

export const MANUFACTURING_NEEDED_QTY_TOOLTIP =
  "Quantity this order requires.";

export const MANUFACTURING_PICKED_QTY_TOOLTIP =
  "Quantity already picked from stock.";

export const MANUFACTURING_REMAINING_QTY_TOOLTIP =
  "Quantity still to pick.";

export const MANUFACTURING_PLANNED_TOTAL_TOOLTIP =
  "Quantity per unit times planned units.";

export const MATERIAL_COST_TOOLTIP = "Sum of actual ingredient costs.";

export const COST_PER_UNIT_TOOLTIP =
  "Material cost divided by actual output.";

export const BATCH_YIELD_TOOLTIP = "Expected good units per batch.";

export const OUTPUT_DISPOSITION_TOOLTIP =
  "Completion lot status: available or blocked.";

export const PURCHASE_ORDER_STATUS_TOOLTIP = {
  draft: "Not yet submitted; no supplier notification.",
  ordered: "Submitted to supplier; awaiting delivery.",
  partial: "Some items received; more still due.",
  received: "All items received.",
  cancelled: "Cancelled; no deliveries expected.",
} as const;

export const PURCHASE_ORDER_STATUS_COLUMN_TOOLTIP =
  "Status values: draft, ordered, partial, received, cancelled.";

export const PO_REMAINING_QTY_TOOLTIP =
  "Quantity still to receive.";

export const STOCKTAKE_STATUS_TOOLTIP = {
  draft: "Counts can still be entered or edited.",
  completed: "Finished; inventory adjusted to match counts.",
  cancelled: "Cancelled; no inventory changes made.",
} as const;

export const STOCKTAKE_STATUS_COLUMN_TOOLTIP =
  "Status values: draft, completed, cancelled.";

export const STOCKTAKE_COUNTED_TOOLTIP =
  "Counted lines so far.";

export const STOCKTAKE_VARIANCE_TOOLTIP =
  "Lines where count differs from snapshot.";

export const STOCKTAKE_SNAPSHOT_QTY_TOOLTIP =
  "Stock quantity recorded when the stocktake was created.";

export const STOCKTAKE_COUNT_QTY_TOOLTIP =
  "Physical quantity counted.";

export const STOCKTAKE_LINE_VARIANCE_TOOLTIP =
  "Counted minus snapshot quantity.";

export const STOCKTAKE_CURRENT_QTY_TOOLTIP =
  "Current available stock.";

export const CUSTOMER_PRICING_TOOLTIP =
  "Customer's assigned price tier.";

export const PRICING_BREAKS_TOOLTIP =
  "Quantity thresholds for tiered pricing.";

export const PRICING_SCOPE_TOOLTIP =
  "Customers this schedule applies to.";

export const MANUFACTURABLE_LINES_TOOLTIP =
  "Lines eligible for manufacturing orders.";
