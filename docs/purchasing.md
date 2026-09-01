---
read_when:
  - Working on the purchasing module
  - Editing suppliers, purchase orders, or receiving
  - Wiring purchase-order UI, API routes, or DAL queries
  - Debugging expected quantities, delete behaviour, or received lots
---

# Purchasing Module

## Scope

Purchasing v1 includes:

- supplier CRUD
- purchase orders for purchasable materials and products
- unsaved new purchase-order cards that keep local edits and wait for a supplier before the first create
- supplier and material snapshots on saved orders
- `not_received`, `partial`, and `received` statuses
- partial receiving into tracked lots or untracked internal inventory buckets
- projection-backed expected supply from active not received and partially received purchase orders, booked as soon as a PO is created
- manual supplier bill creation to a connected accounting provider, before or after receipt
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
- bills can be created before or after receipt. There is **no
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
  PO card edits to save first, then rebuild the bill payload from the saved materials and
  additional costs
- opening the supplier email dialog also requires the latest valid PO card edits to save;
  validation failures stay on the card and the dialog does not open
- bill-affecting edits remain allowed after sync; users reconcile the accounting bill
  separately when needed
- the legacy export routes (`accounting-push`/`xero-push`, `accounting-email`/`xero-email`)
  are **retired** and return HTTP 410; no provider PO-export implementation remains.
  Open POs are imported *from* the provider instead (see Accounting Purchase Order Import)

## Accounting Purchase Order Import

Accounting PO import is a bridge for teams that still create supplier POs in the
provider. It is not the target purchasing workflow.

- auto-sync imports open provider POs when enabled, but leaves POs for manual
  review if a line would create a new ERP material, multiple provider lines map
  to the same ERP material, or a matched material has no purchase-to-stock
  conversion set
- bulk import previews provider POs and applies checked rows
- unmatched provider suppliers/materials may be created during manual import
- imported POs update while unreceived; imports never invoke the operator-only
  received-quantity correction workflow
- re-import preserves a locally assigned additional-cost supplier and
  distribution method when one old and one incoming cost match exactly on type,
  trimmed reference, and numeric amount; after exact matches are consumed, it
  also carries both local fields across an amount edit when exactly one
  unmatched old and incoming cost share a type
- ambiguous duplicate or same-type costs are never guessed; unmatched imported
  costs keep the provider payload's blank supplier assignment and classified
  distribution method
- delivery address is stored on the purchase order header, not per line, and
  the header carries `ship_contact_name` / `ship_contact_phone` alongside the
  address so the attention contact reaches the supplier-facing document. Lines
  keep their own address columns for imported orders; the document prefers the
  header and falls back to the first line that has one

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

Purchase units are independent from optional sales units. Both convert to the
same canonical stocking unit, but a purchase-order line snapshots only its
purchase/stock pair and a sales-order line snapshots only its sales/stock pair.

- `by_value` additional costs are landed cost and are allocated to material
  lines by each line's share of the material subtotal
- `by_quantity` additional costs are landed cost and are allocated by each
  line's share of total ordered purchase-unit quantity; purchase-to-stock
  conversion factors do not affect this allocation
- `not_distributed` additional costs increase the PO total only and do not
  change line `stockUnitCost`, receipt lot cost, or inventory valuation
- new additional-cost rows default to `by_value`; each distributed cost keeps
  its own method, and a line's total allocation is the sum of its value-based
  and quantity-based shares
- create/edit and detail pages show landed cost per stocking unit; this is the
  inventory cost basis users should compare
- receipt lots use the latest PO line landed stock-unit cost at receipt time, so
  additional-cost edits before receipt affect inventory valuation
- after receipt, editing a line price or a distributed additional cost appends
  a `landed_cost_revaluation` event that rebases eligible on-hand tracked lots
  and the material's `currentStockUnitCost`; event metadata records
  `by_value`, `by_quantity`, or `mixed` when additional costs establish an
  allocation basis; the original `purchase_receipt` event is never mutated,
  consumed quantities keep their historical cost, and untracked materials save
  the edit but skip v1 revaluation

- `defaultPurchasePrice` is the price of one purchase unit, not one stock unit
- `purchaseToStockFactor` means "stock units per 1 purchase unit"
- PO lines store both:
  - `unitCost` = purchase-unit price
  - `stockUnitCost` = converted stock-unit cost
- `unit_cost` is `numeric(10,4)`, and supplier invoices routinely quote four
  decimal places. Per-unit costs therefore display through `formatUnitPrice`
  (two decimals minimum, four maximum) on the card grid and the PO PDF; line
  totals, additional costs, and order totals stay on `formatPrice` at two.
  Rounding a per-unit price to cents for display invites re-keying it at two
  decimals, which is a real discrepancy against the supplier's invoice.
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

- A new purchase-order card is local-only until both a supplier and one complete
  material line exist. Header, line, and additional-cost edits remain on the
  card while the first autosave is deferred. The save indicator names whichever
  requirement is still missing.
- an additional-cost row is blank only when its type/distribution are the defaults and
  its reference, amount, and supplier are all blank; choosing a supplier makes the row
  validate and persist, so its amount is required
- creation persists a `not_received` PO and immediately books expected supply for stock lines
- `not_received` orders may be edited, received, or deleted
- `partial` orders may be edited, received, or deleted; already received lines cannot be removed
- `received` orders may be edited or deleted; increasing quantity or adding lines moves the
  order back to `partial`, while landed-cost changes revalue eligible received
  stock. Reducing below received quantity requires the explicit correction flow.
- delete is allowed at any status; deleting a `partial`/`received` order first
  reverses the on-hand remainder of its receipts (see Deleting below)

Valid transitions:

- create `not_received`
- edit `not_received`
- edit `partial`
- edit `received`
- receive `not_received` -> `partial`
- receive `not_received` -> `received`
- receive `partial` -> `partial`
- receive `partial` -> `received`
- close remaining `not_received`/`partial` -> `received`
- soft-delete any status

Invalid transitions:

- reduce ordered quantity below already received quantity through ordinary autosave
- remove received purchase order lines

## Closing a short shipment

`partial` means the balance is still expected, not that the order is unfinished.
When a supplier short-ships and the rest is never arriving, the operator closes
the balance instead of receiving stock that never showed up.

- the receive request carries `closeRemaining`, which is operator intent rather
  than arithmetic: `true` means "this order is done, whatever is outstanding is
  never arriving." It is optional and defaults to `false`, so the Android client
  — which does not send it — keeps its existing partial-receipt behaviour
- the web status control sets it from the chosen status: `Partially received`
  sends `false` and leaves the balance expected; `Received` sends `true`
- closing writes each line's outstanding balance to `quantity_closed` /
  `stock_quantity_closed` and leaves `quantity_ordered` alone, so the line still
  records what was ordered against what arrived
- closed balances are removed from expected supply, and the edit path subtracts
  them when it re-books supply so a later card save cannot resurrect them
- order status counts received **plus** closed against ordered, in both the
  receive path and the edit-path recompute
- `closeRemaining` is valid with an empty `lines` array: closing an order that
  was partially received days ago is a decision, not a receipt. Every other
  receive still requires at least one quantity
- `PATCH /api/purchase-orders/[id]/status` with `received` closes remaining too.
  It no longer returns success without changing status when nothing is
  receivable

## Correcting received quantities

The quantity cell remains editable after partial or full receipt. Ordinary edits
at or above the received quantity use the normal version-guarded autosave path:
an increase represents additional material ordered, adds the new remainder to
expected supply, and moves a fully received order back to `partial`.

An edit below the received quantity is a correction, not a negative receipt.
The card first calls
`GET /api/purchase-orders/[id]/quantity-correction-preview` and presents the
physical and historical impact. Confirmation posts the positive target quantity
to `POST /api/purchase-orders/[id]/quantity-correction` with `expectedVersion`
and an idempotency key. The correction runs atomically and:

- sets both ordered and received purchase quantities to the corrected target
- removes at most the still-on-hand remainder of that line's receipts through
  compensating `manual_adjustment_decrease` events with subtype
  `purchase_receipt_quantity_correction`
- preserves original `purchase_receipt` events and any quantity already
  consumed or moved to a non-available disposition; available receipt stock
  remains attributable when transferred between locations
- records one zero-quantity `purchase_receipt_correction` audit event containing
  the requested, removed, and retained-history quantities
- recalculates landed costs, totals, expected supply, and PO status; a synced
  accounting bill is marked pending and the dialog warns the operator

The target must remain greater than zero. Removing a line is a separate workflow
and remains blocked once it has receipts. For untracked material, removal is
capped at `min(received by this PO, shared bucket on hand)` so another source's
stock is never made negative.

## Deleting

Delete is always available and runs in one transaction:

- `partial`/`received` orders first run `reversePurchaseReceiptsInTx` (kernel):
  each receipt lot's live balance — the un-consumed remainder — is removed via
  compensating `manual_adjustment_decrease` events with subtype
  `purchase_receipt_reversal` referencing the PO. Original `purchase_receipt`
  events and consumed quantities are never touched.
- untracked materials share the internal bucket, so the reversal is capped at
  `min(received by this PO, bucket on hand)` per location
- item `currentStockUnitCost` is not rewritten (negative flows never rewrite
  it); FIFO valuation continues to come from the remaining lots
- expected supply is released (`releaseExpectedFromPurchaseInTx`), linked
  additional-cost POs are soft-deleted, then the PO is soft-deleted
- accounting `document_syncs` rows are left intact; a pushed bill is never
  auto-deleted in the provider
- `GET /api/purchase-orders/[id]/delete-preview` returns the per-item
  remove/kept quantities and a `billSynced` flag; the delete dialog renders it
  so the operator sees exactly what will happen (including the bill warning)

Setting status to `received` through `PATCH /api/purchase-orders/[id]/status` is not a
flag flip — it runs the real `receivePurchaseOrder` path, receiving every remaining line at
the default location into `available` and closing any balance it cannot receive. Setting
`not_received` is a no-op when the PO is already
not received and is not a submit gate. The
operator UI does not call that direct status-receive shortcut: choosing `partial` or
`received` in the status control opens the receive dialog, where the selected `Receive
into` location is posted to the receive endpoint along with the chosen intent. The `/email` route sends the existing
created PO. The `cancelledAt` column on
`purchase_orders` is vestigial: no purchasing code writes or reads it, and removal is
soft-delete (`deletedAt`) only.

## Snapshots

- orders store `supplierName`
- lines store `itemName`, `itemSku`, purchase/stock unit names and factor, and tax rate details;
  new saves snapshot the canonical variant display name
- the editable material grid shows the current item or variant SKU beneath its
  name and falls back to the line's `itemSku` snapshot when the current item is
  unavailable; the Supplier item code and Internal barcode columns are live
  item master data and show an em dash only when their value is empty
- copied supplier/line details are stable while an order is untouched, but editing and
  saving the order refreshes them from current supplier/item/tax records
- reads, emails, PDFs, planning supply, and accounting bill pushes append the
  current assigned option suffix to legacy base-only line snapshots without
  duplicating a suffix already present
- materials used by active not received or partially received purchase orders cannot be soft-deleted from inventory
- suppliers used by active not received or partially received purchase orders cannot be soft-deleted

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
over-received portion never lingers as outstanding expected. Because raising ordered
quantity can change landed-cost allocation, all line costs are recalculated before the
new receipt; eligible tracked stock received earlier from the order is revalued through
the same append-only landed-cost path. A receipt when the remainder is already negative
hard-errors.

## Printable documents

Purchase orders use the shared server-rendered document workflow described in
`docs/printing.md`. The card offers purchase order, request-for-quote, and cumulative received-inventory
variants; Print previews inline and Download PDF returns an attachment. Selected
orders on the list are combined into one PDF.

Each material line prints the supplier item code above the SKU. The supplier
code is read live from the item, not snapshotted onto the line, so reprinting an
old order shows the code as it reads today.

## Expected Supply Projection

Expected supply is now modeled through the inventory kernel:

- the ledger writes `expected_increase` and `expected_release` events
- `inventory_expected_summary` tracks the open per-document expected rows
- `inventory_item_balances.expectedQty` is the hot-path item projection
- not received and partially received purchase orders contribute the material remaining quantity
- released manufacturing orders contribute the unfinished product output side

Implementation rule:

- purchasing DAL code must call kernel expected-supply operations for create, edit, receive, and delete
- purchasing must never mutate expected quantity directly or bypass the kernel projections

## Purchase order invariants — coverage map

Every consequence of acting on a purchase order, the invariant it protects, and whether a test protects it. The only slow story for purchasing is `purchasing-receiving.spec.ts`; it checks that received-order delete remains available and previews the reversal, while the fast lane owns the receipt-reversal database effects and confirmed over-receipt revaluation. Untracked MAC revaluation remains phase 2. The public docs hub carries the operator-facing version of this table without any test/coverage column — keep that mapping here, not there.

| Invariant | Spec | Covered? |
|-----------|------|----------|
| Creation adds the full ordered quantity to expected supply in stocking units; no stock created | `purchasing-receiving.spec.ts` | Yes |
| Ordinary ordered-quantity edits re-derive expected supply; increases above received represent more ordered material | `purchasing-receiving.spec.ts` | Yes |
| A confirmed below-received correction removes only available receipt stock across locations, preserves consumed/non-available history and unrelated untracked receipts, updates ordered/received quantities together, and is idempotent | `purchasing-receiving.spec.ts`; `purchasing-supply-and-receipt.spec.ts` (fast) | Yes |
| Receive writes tracked lots or untracked bucket entries, releases matching expected supply, in one transaction (both-or-neither) | `purchasing-receiving.spec.ts` | Yes |
| Partial receipt: only received part becomes stock; remainder stays expected | `purchasing-receiving.spec.ts` | Yes |
| Full receipt: last remainder becomes stock; status Received; expected fully released | `purchasing-receiving.spec.ts` | Yes |
| Received-line cost or value-/quantity-distributed additional-cost edit revalues eligible on-hand tracked stock via append-only event; consumed and untracked-v1 stock unchanged | `purchasing-receiving.spec.ts` | Yes |
| Over-receipt raises ordered quantity, reconciles expected supply, recalculates landed costs, revalues eligible earlier tracked receipts, then posts the new receipt at the recalculated cost | `purchasing-supply-and-receipt.spec.ts` (fast) | Yes |
| Delete releases the order's remaining expected supply in the same transaction | `purchasing-supply-and-receipt.spec.ts` (fast) | Yes |
| Delete after receipt reverses only the on-hand remainder via `purchase_receipt_reversal` events; `purchase_receipt` events and consumed quantities are preserved | `purchasing-supply-and-receipt.spec.ts` (fast) | Yes |
