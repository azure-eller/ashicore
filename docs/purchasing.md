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
- taxes, discounts, or landed cost
- alternate vendor units or pack conversions
- receiving locations
- supplier lot numbers or expiry dates

## Purchase Units And Inventory Cost

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
