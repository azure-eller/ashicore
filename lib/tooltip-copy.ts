export const CALCULATED_STOCK_TOOLTIP =
  "Stock - committed + expected - safety stock.";

export const CALCULATED_STOCK_ALERT_TOOLTIP =
  "Calculated stock is below zero, so this item is below its safety stock threshold.";

export const OVERSELL_TOOLTIP_COPY = {
  currentCommitted: "Quantity already reserved by confirmed sales orders.",
  expected: "Quantity expected from active released manufacturing orders.",
  safety: "Buffer stock intentionally held back.",
  currentCalculated: "Current calculated stock using the standard formula.",
  projectedCommitted: "Committed quantity after this order is confirmed.",
  projectedCalculated: "Calculated stock after this order is confirmed.",
} as const;

export const MANUFACTURING_SHORTAGE_TOOLTIP =
  "Needed minus available right now.";
