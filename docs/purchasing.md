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
- draft purchase orders for purchasable materials and products
- supplier and material snapshots on saved orders
- `draft`, `ordered`, `partial`, and `received` statuses
- partial receiving into tracked lots or untracked internal inventory buckets
- projection-backed expected supply from active ordered and partially received purchase orders
- manual supplier bill creation to a connected accounting provider, before or after ordering and before or after receipt
- per-line purchase tax (defaults to the org purchase tax rate)

Purchasing v1 does not include:

- payment reconciliation
- discounts
- alternate vendor units or pack conversions
- supplier lot numbers or expiry dates

## Accounting Integration

ERP purchase orders are the operational source of truth. Purchasing owns supplier
documents, units, receiving, lots, expected supply, and landed inventory cost.
Accounting providers receive payable bills, not operational PO exports.

Accounting bill sync routes through `lib/purchasing/queries/bills.ts` to the org's
active provider, but provider capability is not equivalent. Xero supports grouped
supplier bills from one purchase order. QuickBooks bill sync is narrower: it rejects
grouped supplier bill input, rejects tax-bearing bills, and requires additional costs to
be handled manually.

- two billing states are tracked separately: a **manual** bill status the user sets on
  the PO (`purchaseBillManualStatus`: `not_billed`, `partly_billed`, `billed`) and a
  per-document **sync** state on `accounting.document_syncs` (`push_status`: `pending`,
  `pushed`, `failed`)
- creating a bill (`POST /api/purchase-orders/[id]/accounting-bill`) is a manual action,
  not an automatic receipt side effect
- bills can be created before or after ordering and before or after receipt. There is **no
  cancelled-order guard** in the bill path — do not claim one (POs have no cancelled status)
- Xero bill creation groups lines by resolved vendor: PO-supplier material lines bill to
  the PO supplier; vendor-overridden additional costs bill to their carrier/supplier.
  QuickBooks does not support this grouped flow.
- linked child `additional_cost` purchase orders exist only behind the explicit
  additional-cost PO API; adding an additional-cost row in the normal operator workflow
  does not automatically materialize child POs
- material bill lines use ordered purchase-unit quantity and unit cost; descriptions include
  the stock-unit conversion when purchase and stocking units differ; lines use the account
  selected in the bill dialog
- opening provider bill management and creating a provider bill require the latest valid
  PO draft to save first, then rebuild the bill payload from the saved materials and
  additional costs
- bill-affecting edits remain allowed after sync; users reconcile the accounting bill
  separately when needed
- the legacy export routes (`accounting-push`/`xero-push`, `accounting-email`/`xero-email`)
  are **retired** and return HTTP 410; open POs are imported *from* the provider instead
  (see Accounting Purchase Order Import)

## Accounting Purchase Order Import

Accounting PO import is a bridge for teams that still create supplier POs in the
provider. It is not the target purchasing workflow.

- auto-sync imports open provider POs when enabled, but leaves POs for manual
  review if a line would create a new ERP material, multiple provider lines map
  to the same ERP material, or a matched material has no purchase-to-stock
  conversion set
- bulk import previews provider POs and applies checked rows
- unmatched provider suppliers/materials may be created during manual import
- imported POs update while unreceived; received rows still cannot be reduced
  below received quantity
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
- after receipt, editing a line price or a `by_value` additional cost appends a
  `landed_cost_revaluation` event that rebases eligible on-hand tracked lots and
  the material's `currentStockUnitCost`; the original `purchase_receipt` event
  is never mutated, consumed quantities keep their historical cost, and
  untracked materials save the edit but skip v1 revaluation

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
- `received` orders may be edited; increasing quantity or adding lines moves the
  order back to `partial`, while landed-cost changes revalue eligible received
  stock
- delete is allowed only before inventory receipt history exists

Valid transitions:

- create `draft`
- edit `draft`
- edit `ordered`
- edit `partial`
- edit `received`
- order `draft` -> `ordered` through the status menu or the PO email flow
- receive `ordered` -> `partial`
- receive `ordered` -> `received`
- receive `partial` -> `partial`
- receive `partial` -> `received`
- soft-delete `draft`
- soft-delete `ordered`

Invalid transitions:

- reduce ordered quantity below already received quantity
- remove received purchase order lines
- delete `partial`
- delete `received`

Deleting an ordered purchase order releases expected inventory in the same
transaction. Partially received and received orders block deletion because
`purchase_receipt` inventory history must be preserved.

Setting status to `received` through `PATCH /api/purchase-orders/[id]/status` is not a
flag flip — it runs the real `receivePurchaseOrder` path, receiving every remaining line at
the default location into `available`; setting `ordered` runs the real submit workflow. The
operator UI does not call that direct status-receive shortcut: choosing `partial` or
`received` in the status control opens the receive dialog, where the selected `Receive
into` location is posted to the receive endpoint. The `/email` route also runs the submit
workflow first when sending a draft PO email. The `cancelledAt` column on
`purchase_orders` is vestigial: no purchasing code writes or reads it, and removal is
soft-delete (`deletedAt`) only.

## Snapshots

- orders store `supplierName`
- lines store `itemName`, `itemSku`, purchase/stock unit names and factor, and tax rate details
- copied supplier/line details are stable while an order is untouched, but editing and
  saving the order refreshes them from current supplier/item/tax records
- materials used by active draft, ordered, or partial purchase orders cannot be soft-deleted from inventory
- suppliers used by active draft, ordered, or partial purchase orders cannot be soft-deleted

## Receiving

Receiving is positive-only:

- each non-zero tracked received line creates one new lot
- untracked received lines append to the item's hidden shared lot
- the normal operator receive dialog always posts `available` disposition; blocked receipt is API/internal-only
- received quantity = the submitted positive quantity, capped by the remaining quantity in the operator dialog
- receipt cost per unit = purchase-order line landed stock-unit cost
- one `purchase_receipt` inventory event is written per received line
- receiving also emits `expected_release` for the received remainder and flushes the item/expected projections in the same transaction

Materials can be marked lot-untracked on the item card. Untracked materials
append receipts to one hidden `INTERNAL-UNTRACKED` lot for costing and FIFO
audit. Receiving must force `available` disposition and hide lot/disposition
controls from normal operators. Accounting bill sync does not receive or send
lot identifiers.

Blank receive inputs are ignored, and a received quantity must be greater than zero. The
operator receive dialog blocks quantities above the line remainder and does not expose
over-receipt confirmation. API/internal callers can pass `confirmOverReceipt`; on
confirmation the line's ordered (and stock-ordered) quantity is raised to match what was
received and expected supply is reconciled via `editExpectedFromPurchaseInTx`, so the
over-received portion never lingers as outstanding expected. A receipt when the remainder
is already negative hard-errors.

## Expected Supply Projection

Expected supply is now modeled through the inventory kernel:

- the ledger writes `expected_increase` and `expected_release` events
- `inventory_expected_summary` tracks the open per-document expected rows
- `inventory_item_balances.expectedQty` is the hot-path item projection
- ordered and partially received purchase orders contribute the material remaining quantity
- released manufacturing orders contribute the unfinished product output side

Implementation rule:

- purchasing DAL code must call kernel expected-supply operations for order/submit, edit, receive, and delete/cancel
- purchasing must never mutate expected quantity directly or bypass the kernel projections

## Purchase order invariants — coverage map

Every consequence of acting on a purchase order, the invariant it protects, and whether a slow story protects it. The only slow story for purchasing is `purchasing-receiving.spec.ts`; its `SLOW_TEST_STORIES.md` entry lists *delete guards* and *untracked MAC revaluation (phase 2)* under what it does **not** cover, and its covered list does not include the over-receipt path. The public docs hub carries the operator-facing version of this table without any test/coverage column — keep that mapping here, not there.

| Invariant | Spec | Covered? |
|-----------|------|----------|
| Ordering (draft→ordered) adds the full ordered quantity to expected supply in stocking units; no stock created | `purchasing-receiving.spec.ts` | Yes |
| Editing an ordered quantity re-derives expected supply; cannot drop below received quantity | `purchasing-receiving.spec.ts` | Yes |
| Receive writes tracked lots or untracked bucket entries, releases matching expected supply, in one transaction (both-or-neither) | `purchasing-receiving.spec.ts` | Yes |
| Partial receipt: only received part becomes stock; remainder stays expected | `purchasing-receiving.spec.ts` | Yes |
| Full receipt: last remainder becomes stock; status Received; expected fully released | `purchasing-receiving.spec.ts` | Yes |
| Received-line cost / by-value additional-cost edit revalues eligible on-hand tracked stock via append-only event; consumed and untracked-v1 stock unchanged | `purchasing-receiving.spec.ts` | Yes |
| Over-receipt: confirmed receipt raises ordered quantity to match what was received | `purchasing-receiving.spec.ts` | No — not covered by that story |
| Delete an ordered order releases its expected supply in the same transaction | `purchasing-receiving.spec.ts` | No — delete guards excluded by that story |
| Delete blocked after any receipt to preserve `purchase_receipt` inventory and lot-cost history | `purchasing-receiving.spec.ts` | No — delete guards excluded by that story |
