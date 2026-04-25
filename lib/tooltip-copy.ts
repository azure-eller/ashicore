export const CALCULATED_STOCK_TOOLTIP =
  "Stock - demand + expected - safety stock.";

export const CALCULATED_STOCK_ALERT_TOOLTIP =
  "Calculated stock is below zero, so this item is below its safety stock threshold.";

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
