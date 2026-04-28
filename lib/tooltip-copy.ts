export const CALCULATED_STOCK_TOOLTIP =
  "Stock - demand + expected - safety stock.";

export const CALCULATED_STOCK_ALERT_TOOLTIP =
  "Calculated stock is below zero, so this item is below its safety stock threshold.";

export const AVAILABLE_QTY_TOOLTIP =
  "Reservable stock after existing hard reservations.";

export const RESERVED_QTY_TOOLTIP =
  "Stock hard-reserved for accepted demand.";

export const DEMAND_QTY_TOOLTIP = "Accepted sales and manufacturing demand.";

export const BACKORDER_QTY_TOOLTIP =
  "Demand that can't be filled from current stock.";

export const POTENTIAL_TOOLTIP =
  "Units producible from current ingredient stock.";

export const NOT_SELLABLE_TOOLTIP = "Item is hidden from sales orders.";

export const RESERVATION_STATUS_TOOLTIP = {
  fully: "All accepted demand is hard-reserved.",
  partial: "Some accepted demand is hard-reserved; the rest is backordered.",
  backordered: "Accepted demand has no stock reserved.",
} as const;

export const LOT_DISPOSITION_TOOLTIP =
  "Lot status: available, blocked, rejected, or scrap.";

export const SALES_ORDER_STATUS_TOOLTIP = {
  draft: "Not yet submitted; reserves no stock.",
  confirmed: "Stock reserved; awaiting shipment.",
  shipped: "Stock consumed and the order is closed.",
  cancelled: "Order voided; reservations released.",
} as const;

export const SALES_ORDER_STATUS_COLUMN_TOOLTIP =
  "Order state: draft, confirmed, shipped, or cancelled.";

export const MANUFACTURING_ORDER_STATUS_TOOLTIP = {
  draft: "Planned but not yet released to the floor.",
  released: "Released to manufacturing; ingredients reserved.",
  completed: "Production finished and output stocked.",
  cancelled: "Order voided; reservations released.",
} as const;

export const MANUFACTURING_ORDER_STATUS_COLUMN_TOOLTIP =
  "Order state: draft, released, completed, or cancelled.";

export const PICK_PROGRESS_TOOLTIP = {
  not_started: "No ingredients picked yet.",
  in_progress: "Some ingredients picked; rest still need picking.",
  picked: "All ingredients picked from stock.",
} as const;

export const MANUFACTURING_PLANNED_QTY_TOOLTIP =
  "Quantity scheduled, rounded to batch size.";

export const OVERSELL_TOOLTIP_COPY = {
  currentAvailable: "Reservable stock after existing hard reservations.",
  currentReserved: "Available stock already hard-reserved.",
  currentDemand: "Customer demand already accepted.",
  currentShortage: "Accepted demand that is not hard-reserved.",
  expected: "Quantity expected from active released manufacturing orders.",
  safety: "Buffer stock intentionally held back.",
  currentCalculated: "Current calculated stock using the standard formula.",
  projectedDemand: "Demand after this order is confirmed.",
  projectedShortage: "Unreserved demand after this order is confirmed.",
  projectedCalculated: "Calculated stock after this order is confirmed.",
} as const;

export const MANUFACTURING_SHORTAGE_TOOLTIP =
  "Needed minus available right now.";

export const MANUFACTURING_NEEDED_QTY_TOOLTIP =
  "Quantity required for this order.";

export const MANUFACTURING_PICKED_QTY_TOOLTIP =
  "Quantity already picked from stock.";

export const MANUFACTURING_REMAINING_QTY_TOOLTIP =
  "Outstanding quantity still to be picked.";

export const MANUFACTURING_PLANNED_TOTAL_TOOLTIP =
  "Quantity per unit × planned units.";

export const MATERIAL_COST_TOOLTIP = "Sum of actual ingredient costs.";

export const COST_PER_UNIT_TOOLTIP =
  "Material cost divided by actual output.";

export const BATCH_YIELD_TOOLTIP = "Expected good units per batch.";

export const OUTPUT_DISPOSITION_TOOLTIP =
  "Lot status on completion: available (sellable) or blocked (held).";

export const PURCHASE_ORDER_STATUS_TOOLTIP = {
  draft: "Not yet submitted; no supplier notification.",
  ordered: "Submitted to supplier; awaiting delivery.",
  partial: "Some items received; balance still pending.",
  received: "All items received and recorded.",
  cancelled: "Order voided; no deliveries expected.",
} as const;

export const PURCHASE_ORDER_STATUS_COLUMN_TOOLTIP =
  "Order state: draft, ordered, partial, received, or cancelled.";

export const PO_REMAINING_QTY_TOOLTIP =
  "Outstanding quantity still to be received.";

export const STOCKTAKE_STATUS_TOOLTIP = {
  draft: "In progress; counts can still be entered or edited.",
  completed: "Finished; inventory adjusted to match counts.",
  cancelled: "Voided; no inventory adjustments made.",
} as const;

export const STOCKTAKE_STATUS_COLUMN_TOOLTIP =
  "Stocktake state: draft, completed, or cancelled.";

export const STOCKTAKE_COUNTED_TOOLTIP =
  "Number of items counted so far.";

export const STOCKTAKE_VARIANCE_TOOLTIP =
  "Items where the count doesn't match the snapshot.";

export const STOCKTAKE_SNAPSHOT_QTY_TOOLTIP =
  "Stock quantity recorded when the stocktake was created.";

export const STOCKTAKE_COUNT_QTY_TOOLTIP =
  "Quantity the user counted as physically present.";

export const STOCKTAKE_LINE_VARIANCE_TOOLTIP =
  "Counted minus snapshot quantity.";

export const STOCKTAKE_CURRENT_QTY_TOOLTIP =
  "Current available stock right now.";

export const CUSTOMER_PRICING_TOOLTIP =
  "Customer pricing category or tier.";

export const PRICING_BREAKS_TOOLTIP =
  "Quantity thresholds for tiered pricing.";

export const PRICING_SCOPE_TOOLTIP =
  "Customer category this pricing applies to.";

export const MANUFACTURABLE_LINES_TOOLTIP =
  "Order lines that can be sourced from a manufacturing order.";
