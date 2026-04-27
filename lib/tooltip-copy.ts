export const CALCULATED_STOCK_TOOLTIP =
  "Stock - demand + expected - safety stock.";

export const CALCULATED_STOCK_ALERT_TOOLTIP =
  "Calculated stock is below zero, so this item is below its safety stock threshold.";

export const AVAILABLE_QTY_TOOLTIP =
  "Reservable stock after demand and reservations.";

export const RESERVED_QTY_TOOLTIP =
  "Stock already hard-reserved against confirmed orders.";

export const DEMAND_QTY_TOOLTIP = "Customer demand from accepted orders.";

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

export const MANUFACTURING_ORDER_STATUS_TOOLTIP = {
  draft: "Planned but not yet released to the floor.",
  released: "Released to manufacturing; ingredients reserved.",
  completed: "Production finished and output stocked.",
  cancelled: "Order voided; reservations released.",
} as const;

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
