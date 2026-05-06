export const CALCULATED_STOCK_TOOLTIP =
  "Stock - demand + expected - safety stock.";

export const CALCULATED_STOCK_ALERT_TOOLTIP =
  "Below safety stock after demand and expected supply.";

export const ON_HAND_STOCK_TOOLTIP =
  "Physical stock currently on hand.";

export const AVAILABLE_QTY_TOOLTIP =
  "Available-disposition stock minus existing reservations.";

export const RESERVED_QTY_TOOLTIP =
  "Stock already reserved for demand.";

export const DEMAND_QTY_TOOLTIP =
  "Demand from confirmed sales and released manufacturing orders.";

export const BACKORDER_QTY_TOOLTIP =
  "Accepted demand not covered by reservations.";

export const EXPECTED_QTY_TOOLTIP =
  "Inbound supply from open manufacturing and purchase orders.";

export const SAFETY_STOCK_TOOLTIP =
  "Stock held back as a buffer.";

export const PROJECTED_VS_SAFETY_TOOLTIP =
  "Stock after demand and expected supply, compared to safety stock.";

export const POTENTIAL_TOOLTIP =
  "Units producible now from available eligible ingredient stock.";

export const STOCKING_UNIT_TOOLTIP =
  "Unit used for inventory balances and stock movements.";

export const ITEM_SKU_TOOLTIP =
  "Stock keeping unit used as the item code.";

export const ITEM_TYPE_TOOLTIP =
  "Inventory classification: material or product.";

export const ITEM_CATEGORY_TOOLTIP =
  "Grouping used to organize inventory items.";

export const VARIANT_AXES_TOOLTIP =
  "Attributes that define product variants.";

export const UNIT_TOOLTIP =
  "Unit used for this line quantity.";

export const CURRENT_STOCK_UNIT_COST_TOOLTIP =
  "Material cost basis per stocking unit.";

export const PURCHASE_PRICE_TOOLTIP =
  "Default supplier price per purchase unit.";

export const SELLING_PRICE_TOOLTIP =
  "Default sales price per selling unit.";

export const MARGIN_TOOLTIP =
  "Default margin; master rows average sellable variants.";

export const ESTIMATED_MARGIN_TOOLTIP =
  "Selling price minus estimated COGS, as a percent of selling price.";

export const ACTUAL_MARGIN_TOOLTIP =
  "Selling price minus actual FIFO COGS, as a percent of selling price.";

export const LINE_COGS_TOOLTIP =
  "Inventory cost tied to the line.";

export const ESTIMATED_LINE_COGS_TOOLTIP =
  "Estimated inventory cost for the line quantity.";

export const LOT_PHYSICAL_TOOLTIP =
  "Physical lot balance across all dispositions.";

export const LOT_NUMBER_TOOLTIP =
  "Lot identifier assigned to inventory stock.";

export const LOT_UNIT_COST_TOOLTIP =
  "Inventory value assigned to one stocking unit.";

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
  partially_shipped: "Some stock shipped; remaining demand still open.",
  shipped: "Stock shipped; order closed.",
  cancelled: "Cancelled; reservations released.",
} as const;

export const SALES_ORDER_STATUS_COLUMN_TOOLTIP =
  "Status values: draft, confirmed, partially shipped, shipped, cancelled.";

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

export const MANUFACTURING_ACTUAL_QTY_TOOLTIP =
  "Good output completed on the order.";

export const MANUFACTURING_SALES_ORDER_TOOLTIP =
  "Sales order line claimed by this manufacturing order.";

export const MANUFACTURING_EXECUTION_TOOLTIP =
  "Ingredient picking progress for the order.";

export const MANUFACTURING_COMPONENT_COST_TOOLTIP =
  "Actual cost consumed for this ingredient.";

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

export const BOM_QTY_PER_BATCH_TOOLTIP =
  "Component quantity required per batch.";

export const BOM_QTY_PER_UNIT_TOOLTIP =
  "Component quantity required per finished unit.";

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

export const EXPECTED_DELIVERY_DATE_TOOLTIP =
  "Supplier delivery date used for inbound supply planning.";

export const PO_REMAINING_QTY_TOOLTIP =
  "Quantity still to receive.";

export const PO_ORDERED_QTY_TOOLTIP =
  "Quantity ordered from the supplier.";

export const PURCHASE_UNIT_TOOLTIP =
  "Supplier unit used on purchase orders.";

export const PURCHASE_UNIT_COST_TOOLTIP =
  "Cost per purchase unit.";

export const PURCHASE_CONVERSION_TOOLTIP =
  "Purchase units converted to stocking units.";

export const SUPPLIER_CODE_TOOLTIP =
  "Internal supplier identifier.";

export const PAYMENT_TERMS_TOOLTIP =
  "Default payment terms for supplier purchases.";

export const PO_RECEIVED_QTY_TOOLTIP =
  "Quantity already received against the order.";

export const PO_RECEIVE_NOW_TOOLTIP =
  "Quantity to receive in this transaction.";

export const RECEIPT_DISPOSITION_TOOLTIP =
  "Receipt lot status: available or blocked.";

export const STOCKTAKE_STATUS_TOOLTIP = {
  draft: "Counts can still be entered or edited.",
  completed: "Finished; inventory adjusted to match counts.",
  cancelled: "Cancelled; no inventory changes made.",
} as const;

export const STOCKTAKE_STATUS_COLUMN_TOOLTIP =
  "Status values: draft, completed, cancelled.";

export const STOCKTAKE_SCOPE_TOOLTIP =
  "Items included in the stocktake snapshot.";

export const STOCKTAKE_ITEM_COUNT_TOOLTIP =
  "Stocktake lines included in the snapshot.";

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

export const PRICING_CATEGORY_TOOLTIP =
  "Customer group used for pricing rules.";

export const PRICING_BREAKS_TOOLTIP =
  "Quantity thresholds for tiered pricing.";

export const PRICING_SCOPE_TOOLTIP =
  "Customers this schedule applies to.";

export const PRICING_UNIT_TOOLTIP =
  "Unit the price breaks apply to.";

export const MANUFACTURABLE_LINES_TOOLTIP =
  "Lines eligible for manufacturing orders.";

export const REQUESTED_DATE_TOOLTIP =
  "Customer-facing delivery date.";

export const SALES_ORDER_SHIP_DATE_TOOLTIP =
  "Operational load date for shipment and production planning.";

export const SALES_ORDER_DATE_TOOLTIP =
  "Date the customer placed the order.";

export const SALES_LINE_QTY_TOOLTIP =
  "Quantity requested by the sales line.";

export const SALES_UNIT_PRICE_TOOLTIP =
  "Price charged per sales unit.";

export const LINE_TOTAL_TOOLTIP =
  "Quantity times unit price.";

export const ORDER_TOTAL_TOOLTIP =
  "Sum of order line totals.";

export const DISCOUNT_PERCENT_TOOLTIP =
  "Percent discount applied to base price.";

export const MIN_QTY_TOOLTIP =
  "Minimum quantity for this price break.";

export const MAX_QTY_TOOLTIP =
  "Maximum quantity for this price break.";

export const LEDGER_OCCURRED_TOOLTIP =
  "Timestamp when the inventory event posted.";

export const LEDGER_EVENT_TOOLTIP =
  "Inventory event posted to the ledger.";

export const LEDGER_SOURCE_TOOLTIP =
  "Business document that caused the event.";

export const LEDGER_LOT_TOOLTIP =
  "Lot affected by the event.";

export const LEDGER_ACTOR_TOOLTIP =
  "User or system process that posted the event.";

export const LEDGER_MOVEMENT_TOOLTIP =
  "Movement category for stock and value events.";

export const LEDGER_SCOPE_TOOLTIP =
  "Stock-only events or all ledger events.";

export const LEDGER_EVENT_TYPE_TOOLTIP =
  "Specific inventory ledger event type.";

export const LEDGER_DOCUMENT_TYPE_TOOLTIP =
  "Business document type linked to ledger events.";

export const LEDGER_CHANGE_TOOLTIP =
  "Signed quantity posted by the event.";

export const LEDGER_ON_HAND_AFTER_TOOLTIP =
  "On-hand stock after the event posted.";

export const LEDGER_VALUE_CHANGE_TOOLTIP =
  "Signed inventory value change for the event.";

export const PLANNING_NEED_TOOLTIP =
  "Quantity required to satisfy open demand.";

export const PLANNING_SHORT_TOOLTIP =
  "Required quantity not covered by stock.";

export const PLANNING_REORDER_COMPARISON_TOOLTIP =
  "Projected stock after demand and expected supply compared with safety stock.";

export const PLANNING_DAYS_COVER_TOOLTIP =
  "Estimated days current stock covers demand.";

export const PLANNING_SUGGESTED_QTY_TOOLTIP =
  "Recommended purchase quantity from planning rules.";

export const PLANNING_NEEDED_BY_TOOLTIP =
  "Date demand needs this supply.";

export const PLANNING_NEEDED_FOR_TOOLTIP =
  "Demand source that requires this item.";

export const PLANNING_MOQ_TOOLTIP =
  "Minimum purchase quantity for this supplier item.";

export const PLANNING_ORDER_MULTIPLE_TOOLTIP =
  "Required purchase increment for this supplier item.";
