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
- `draft`, `ordered`, `partial`, and `received` statuses
- partial receiving into lot-backed inventory
- projection-backed expected supply from active ordered and partially received purchase orders
- manual supplier bill sync to Xero after submit and before or after receipt

Purchasing v1 does not include:

- payment reconciliation
- taxes or discounts
- alternate vendor units or pack conversions
- receiving locations
- supplier lot numbers or expiry dates

## Accounting Integration

ERP purchase orders are the operational source of truth. Purchasing owns supplier
documents, units, receiving, lots, expected supply, and landed inventory cost.
Accounting providers receive payable bills, not operational PO exports.

Xero bill sync:

- purchase orders expose a separate bill status: not billed, syncing, billed, or failed
- `Create Xero Bill` is a manual action, not an automatic receipt side effect
- Xero bills can be created after submit and before or after receipt, but only one full bill is created per PO
- Xero bill lines use ordered purchase-unit quantity and unit cost; descriptions include the stock-unit conversion when purchase and stocking units differ
- Xero bill lines use the account selected in the bill dialog
- additional PO costs are not sent to Xero in v1; when present, users must confirm that they will add those costs manually in Xero
- bill-affecting edits are blocked after a successful bill sync

## Accounting Purchase Order Import

Accounting PO import is a bridge for teams that still create supplier POs in the
provider. It is not the target purchasing workflow.

- auto-sync imports open provider POs when enabled, but leaves POs for manual
  review if a line would create a new ERP material, multiple provider lines map
  to the same ERP material, or a matched material has no purchase-to-stock
  conversion set
- bulk import previews provider POs and applies checked rows
- unmatched provider suppliers/materials may be created during manual import
- imported POs update while unreceived, but received line quantities and
  receipt-time costs are protected
- delivery address is stored on the purchase order header, not per line

## Supplier Items

`supplier_items` stores supplier-specific purchasing defaults. Accounting
provider purchasing sync may create or update these rows from selected PO/bill
history candidates:

- `supplierSku` comes from the provider line item code
- `unitCost` comes from recent provider purchase history
- matched rows update existing ERP suppliers/items
- unmatched selected rows may create missing ERP suppliers/items before writing the supplier item
- provider item codes stay external metadata and must not replace ERP `items.sku`

Accounting connector rule: purchasing import/export workflows use generic
`/api/accounting/*` routes and `lib/accounting/providers/*` adapters. Do not add
provider-specific workflow routes for future connectors.

## Purchase Units And Inventory Cost

Purchase orders may store additional costs for `shipping`, `customs`, and
`other`.

- `by_value` additional costs are landed cost and are allocated to material
  lines by each line's share of the material subtotal
- `not_distributed` additional costs increase the PO total only and do not
  change line `stockUnitCost`, receipt lot cost, or inventory valuation
- create/edit and detail pages show landed cost per stocking unit; this is the
  inventory cost basis users should compare
- receipt lots use the latest PO line landed stock-unit cost at receipt time, so
  additional-cost edits before receipt affect inventory valuation
- after a partial receipt, additional-cost edits affect future receipts only;
  already received lots keep their original unit cost

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
- purchase receipts update it with a weighted average using stock-unit quantities and receipt-time landed stock-unit cost
- if prior on-hand is `<= 0`, the next receipt replaces the stored value with the incoming stock-unit cost instead of averaging
- when stock reaches `0`, keep the last stored value until a later receipt replaces it
- correction-class positive flows such as manual increases and stocktake gains may use `currentStockUnitCost` as the fallback lot cost, but they do not rewrite the item field
- negative flows never rewrite it; FIFO valuation continues to come from the consumed lots themselves

## Status Rules

- `draft` orders are editable
- `ordered` orders may be edited, received, or deleted before any receipt
- `partial` orders may be edited or received; already received lines cannot be removed
- `received` orders are terminal
- delete is allowed only before inventory receipt history exists

Valid transitions:

- create `draft`
- edit `draft`
- edit `ordered`
- edit `partial`
- submit `draft` -> `ordered`
- receive `ordered` -> `partial`
- receive `ordered` -> `received`
- receive `partial` -> `received`
- soft-delete `draft`
- soft-delete `ordered`
- soft-delete `received`

Invalid transitions:

- reduce ordered quantity below already received quantity
- remove received purchase order lines
- delete `partial`
- delete `received`

Deleting an ordered purchase order releases expected inventory in the same
transaction. Partially received and received orders block deletion because
`purchase_receipt` inventory history must be preserved.

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

Materials can be marked lot-untracked on the item card. Untracked materials
append receipts to one hidden `INTERNAL-UNTRACKED` lot for costing and FIFO
audit. Receiving must force `available` disposition and hide lot/disposition
controls from normal operators. Xero bill sync does not receive or send lot
identifiers.

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
