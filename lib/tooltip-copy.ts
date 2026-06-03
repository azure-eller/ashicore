export const CALCULATED_STOCK_TOOLTIP =
  "Stock - demand + expected - safety stock.";

export const CALCULATED_STOCK_ALERT_TOOLTIP =
  "Below safety stock after demand and expected supply.";

export const ON_HAND_STOCK_TOOLTIP =
  "Physical stock currently on hand.";

export const AVAILABLE_QTY_TOOLTIP =
  "Stock not currently reserved by other orders.";

export const RESERVED_QTY_TOOLTIP =
  "Stock already reserved for demand.";

export const SALES_LINE_ALLOCATED_QTY_TOOLTIP =
  "Stock reserved by this sales order line.";

export const DEMAND_QTY_TOOLTIP =
  "Demand from open sales and active manufacturing orders.";

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
  "Default selling price minus estimated COGS.";

export const ESTIMATED_MARGIN_TOOLTIP =
  "Selling price minus estimated COGS, as a percent of selling price.";

export const ACTUAL_MARGIN_TOOLTIP =
  "Selling price minus actual FIFO COGS, as a percent of selling price.";

export const LINE_COGS_TOOLTIP =
  "Inventory cost tied to the line.";
export const UNIT_COST_TOOLTIP =
  "Inventory cost per unit.";
export const UNIT_MARGIN_TOOLTIP =
  "Unit price minus unit cost.";

export const ESTIMATED_LINE_COGS_TOOLTIP =
  "Estimated inventory cost for the line quantity.";
export const ESTIMATED_ORDER_COGS_TOOLTIP =
  "Estimated until the order is manufactured and shipped.";
export const ESTIMATED_SHIPMENT_COSTS_TOOLTIP =
  "Estimated until shipped and actual costs are entered.";

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
  open: "Active order with remaining operational work.",
  done: "Closed order with no remaining operational work.",
} as const;

export const SALES_ORDER_STATUS_COLUMN_TOOLTIP =
  "Status values: open or done.";

export const MANUFACTURING_ORDER_STATUS_TOOLTIP = {
  open: "Active production order.",
  done: "Closed production order.",
} as const;

export const MANUFACTURING_ORDER_STATUS_COLUMN_TOOLTIP =
  "Status values: open or done.";

export const PICK_PROGRESS_TOOLTIP = {
  not_started: "No ingredients done yet.",
  in_progress: "Some ingredients done; some still open.",
  picked: "All ingredients are done.",
} as const;

export const MANUFACTURING_PLANNED_QTY_TOOLTIP =
  "Output scheduled after batch rounding.";

export const MANUFACTURING_ACTUAL_QTY_TOOLTIP =
  "Good output completed on the order.";

export const MANUFACTURING_SALES_ORDER_TOOLTIP =
  "Sales order line claimed by this manufacturing order.";

export const MANUFACTURING_EXECUTION_TOOLTIP =
  "Ingredient completion progress for the order.";

export const MANUFACTURING_COMPONENT_COST_TOOLTIP =
  "Actual cost consumed for this ingredient.";

export const MANUFACTURING_SHORTAGE_TOOLTIP =
  "Needed minus available.";

export const MANUFACTURING_NEEDED_QTY_TOOLTIP =
  "Quantity this order requires.";

export const MANUFACTURING_PICKED_QTY_TOOLTIP =
  "Quantity already marked done.";

export const MANUFACTURING_REMAINING_QTY_TOOLTIP =
  "Quantity still open.";

export const MANUFACTURING_PLANNED_TOTAL_TOOLTIP =
  "Quantity per unit times planned units.";

export const BOM_QTY_PER_BATCH_TOOLTIP =
  "Component quantity required per batch.";

export const BOM_QTY_PER_UNIT_TOOLTIP =
  "Component quantity required per finished unit.";

export const MATERIAL_COST_TOOLTIP = "Sum of actual ingredient costs.";

export const OPERATIONS_COST_TOOLTIP =
  "Standard operation cost absorbed into produced inventory.";

export const COST_PER_UNIT_TOOLTIP =
  "Material plus absorbed operation cost divided by actual output.";

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

export const PURCHASE_MATERIAL_TOOLTIP =
  "Material being ordered from the supplier.";

export const PO_LINE_TOTAL_TOOLTIP =
  "Ordered quantity times purchase unit cost.";

export const PURCHASE_LANDED_UNIT_TOOLTIP =
  "Estimated stock-unit cost after distributed costs.";

export const PURCHASE_DELIVERY_ADDRESS_TOOLTIP =
  "Destination for this line.";

export const PURCHASE_ACCOUNT_TOOLTIP =
  "Expense account used when syncing the purchase.";

export const PURCHASE_ADDITIONAL_COST_TYPE_TOOLTIP =
  "Freight, customs, or other cost on this order.";

export const PURCHASE_COST_REFERENCE_TOOLTIP =
  "Supplier invoice, tracking, or internal reference.";

export const PURCHASE_COST_DISTRIBUTION_TOOLTIP =
  "How this cost affects material landed costs.";

export const PURCHASE_COST_AMOUNT_TOOLTIP =
  "Cost amount added to this purchase order.";

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
  cancelled: "Removed without inventory changes.",
  deleted: "Removed without inventory changes.",
} as const;

export const STOCKTAKE_STATUS_COLUMN_TOOLTIP =
  "Status values: draft, completed, deleted.";

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

export const PRICING_ITEM_CATEGORY_TOOLTIP =
  "Sellable items this schedule applies to.";

export const MANUFACTURABLE_LINES_TOOLTIP =
  "Lines eligible for manufacturing orders.";

export const REQUESTED_DATE_TOOLTIP =
  "Customer-facing delivery date.";

export const SALES_ORDER_SHIP_DATE_TOOLTIP =
  "Delivery deadline used for fulfillment and production planning.";

export const SALES_ORDER_DATE_TOOLTIP =
  "Date the customer placed the order.";

export const SALES_ORDER_RANK_TOOLTIP =
  "Open-order priority; drag to reorder.";

export const SALES_ORDER_NUMBER_TOOLTIP =
  "Internal sales order number.";

export const SALES_ORDER_CUSTOMER_TOOLTIP =
  "Customer attached to the order.";

export const SALES_ORDER_NOTES_TOOLTIP =
  "Internal order notes.";

export const SALES_ORDER_ITEMS_STATUS_TOOLTIP =
  "Stock coverage for sales lines.";

export const SALES_ORDER_INGREDIENTS_STATUS_TOOLTIP =
  "Ingredient coverage for manufacturable sales lines.";

export const SALES_ORDER_PRODUCTION_STATUS_TOOLTIP =
  "Manufacturing coverage for order lines.";

export const SALES_ORDER_DELIVERY_STATUS_TOOLTIP =
  "Shipment state for the sales order.";

export const SALES_LINE_QTY_TOOLTIP =
  "Quantity requested by the sales line.";

export const SALES_LINE_DEMAND_TOOLTIP =
  "Total quantity requested by this sales line.";

export const SALES_LINE_AVAILABLE_TOOLTIP =
  "Usable stock available for this sales line.";

export const SALES_LINE_CAN_MAKE_TOOLTIP =
  "Quantity that can be made from available inputs.";

export const SALES_LINE_ALLOCATION_TOOLTIP =
  "Sources currently covering this sales line.";

export const SALES_LINE_SHORT_TOOLTIP =
  "Remaining quantity not covered by allocation.";

export const ALLOCATION_SOURCE_TOOLTIP =
  "Lot or manufacturing order that can supply this demand.";

export const ALLOCATION_ON_HAND_TOOLTIP =
  "Physical lot quantity before other assignments.";

export const ALLOCATION_EXPECTED_TOOLTIP =
  "Open production quantity before other assignments.";

export const ALLOCATION_AVAILABLE_TOOLTIP =
  "Uncommitted quantity available from this source.";

export const ALLOCATION_CURRENT_TOOLTIP =
  "Quantity already assigned from this source to this line.";

export const ALLOCATION_ALLOCATE_TOOLTIP =
  "Quantity to assign from this source when saved.";

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

export const LEDGER_CHANGE_TOOLTIP =
  "Signed quantity posted by the event.";

export const LEDGER_ON_HAND_AFTER_TOOLTIP =
  "On-hand stock after the event posted.";
export const LEDGER_ON_HAND_BEFORE_TOOLTIP =
  "On-hand stock before the event posted.";

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
