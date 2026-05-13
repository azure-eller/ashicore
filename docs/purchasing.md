---
read_when:
  - Working on the purchasing module
  - Editing suppliers, purchase orders, or receiving
  - Wiring purchase-order UI, API routes, or DAL queries
  - Debugging expected quantities, delete guards, or received lots
---

# Purchasing Module

## Scope

Purchasing v1 includes:

- supplier CRUD
- draft purchase orders for materials only
- supplier and material snapshots on saved orders
- `draft`, `ordered`, `partial`, `received`, and `cancelled` statuses
- partial receiving into lot-backed inventory
- projection-backed expected supply from active ordered and partially received purchase orders

Purchasing v1 does not include:

- invoices or payments
- taxes or discounts
- alternate vendor units or pack conversions
- receiving locations
- supplier lot numbers or expiry dates

## Supplier Items

`supplier_items` stores supplier-specific purchasing defaults. Xero purchasing
sync may create or update these rows from selected PO/bill history candidates:

- `supplierSku` comes from the Xero line item code
- `unitCost` comes from recent Xero purchase history
- rows are written only after an existing ERP supplier and item are matched
- Xero item codes stay external metadata and must not replace ERP `items.sku`

## Purchase Units And Inventory Cost

Purchase orders may store additional costs for `shipping`, `customs`, and
`other`.

- `by_value` additional costs are landed cost and are allocated to material
  lines by each line's share of the material subtotal
- `not_distributed` additional costs increase the PO total only and do not
  change line `stockUnitCost`, receipt lot cost, or inventory valuation
- receipt lots use the saved PO line `stockUnitCost`, so distributed additional
  costs affect material running stock cost through the normal receipt flow

- `defaultPurchasePrice` is the price of one purchase unit, not one stock unit
- `purchaseToStockFactor` means "stock units per 1 purchase unit"
- PO lines store both:
  - `unitCost` = purchase-unit price
  - `stockUnitCost` = converted stock-unit cost
- inventory lots, ledger `unit_cost`, BOM ingredient rollups, stocktake gains, and manual increases always use stock-unit cost

Example:

- purchase unit = `325 Gallon Tote`
- stock unit = `Gallon`
- `defaultPurchasePrice = 250`
- `purchaseToStockFactor = 325`
- stock-unit cost = `250 / 325 = 0.769231`

### Material Running Stock Cost

Materials also carry `items.currentStockUnitCost`, which is the current stock-unit cost basis for future positive stock writes and planning reads.

- `defaultPurchasePrice` stays user-editable and remains a purchase-unit price
- `currentStockUnitCost` is system state, not a manual default field
- positive stock writes resolve material cost in this order:
  1. explicit stock-unit cost on the write
  2. `currentStockUnitCost`
  3. derived `defaultPurchasePrice / purchaseToStockFactor`
  4. fail with a missing-cost error

Update rules:

- opening balances seed `currentStockUnitCost` when they provide an explicit unit cost
- purchase receipts update it with a weighted average using stock-unit quantities and line `stockUnitCost`
- if prior on-hand is `<= 0`, the next receipt replaces the stored value with the incoming stock-unit cost instead of averaging
- when stock reaches `0`, keep the last stored value until a later receipt replaces it
- correction-class positive flows such as manual increases and stocktake gains may use `currentStockUnitCost` as the fallback lot cost, but they do not rewrite the item field
- negative flows never rewrite it; FIFO valuation continues to come from the consumed lots themselves

## Status Rules

- `draft` orders are editable
- `ordered` orders are frozen and may be received or cancelled
- `partial` orders are frozen and may only continue receiving
- `received` orders are terminal
- `cancelled` orders are terminal

Valid transitions:

- create `draft`
- edit `draft`
- submit `draft` -> `ordered`
- receive `ordered` -> `partial`
- receive `ordered` -> `received`
- receive `partial` -> `received`
- cancel `ordered`
- soft-delete `draft`
- soft-delete `received`
- soft-delete `cancelled`

Invalid transitions:

- edit `ordered`
- edit `partial`
- cancel `partial`
- delete `ordered`
- delete `partial`

## Snapshots

- orders store `supplierName`
- lines store `itemName`, `itemSku`, and `unitName`
- list/detail pages render snapshots so renamed or deleted suppliers/materials do not break history
- materials used by active draft, ordered, or partial purchase orders cannot be soft-deleted from inventory
- suppliers used by active draft, ordered, or partial purchase orders cannot be soft-deleted

## Receiving

Receiving is lot-backed and positive-only:

- each non-zero received line creates one new internal lot
- lot quantity = received quantity
- lot disposition may be `available` or `blocked`; default is `available`
- lot cost per unit = purchase-order line unit cost
- one `purchase_receipt` inventory event is written per received lot
- receiving also emits `expected_release` for the received remainder and flushes the item/expected projections in the same transaction

Blank receive inputs are ignored. Received quantity must be greater than zero and no greater than the current line remainder.

## Expected Supply Projection

Expected supply is now modeled through the inventory kernel:

- the ledger writes `expected_increase` and `expected_release` events
- `inventory_expected_summary` tracks the open per-document expected rows
- `inventory_item_balances.expectedQty` is the hot-path item projection
- ordered and partially received purchase orders contribute the material remaining quantity
- released manufacturing orders contribute the unfinished product output side

Implementation rule:

- purchasing DAL code must call kernel expected-supply operations for submit, edit, receive, and cancel
- purchasing must never mutate expected quantity directly or bypass the kernel projections
