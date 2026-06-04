---
read_when:
  - Planning or implementing stocktakes
  - Editing stocktake schema, DAL, or API routes
  - Working on stock reconciliation flows
  - Deciding how stocktakes interact with lots and stock movements
---

# Stocktakes

## Scope

Stocktakes are an **inventory-native** reconciliation workflow.

Stocktakes support creation-mode snapshots plus lot-aware blind counts:

- new stocktakes start from one creation mode:
  - `empty`: header only; users add rows while counting
  - `in_stock`: non-deleted material/product variants with physical `onHandQty > 0`
  - `all`: all non-deleted material/product variants
- category-scoped creation is no longer exposed for new stocktakes; old category
  scopes remain readable
- users can copy any visible stocktake into a fresh draft; copy preserves item
  rows and order only, not counts or notes
- count entry happens on the stocktake detail page and is blind: draft UIs do
  not show expected/current stock or variance
- lot-tracked items with active available lots snapshot those lots and count per lot
- during a lot-tracked count, operators can add a **found lot** — a lot present on
  the floor that does not match a snapshotted lot or any existing lot record for
  the item — by entering its lot number; it's recorded under the item as a found
  lot rather than editing an existing lot row
- lot-untracked items are counted at item level; their single `INTERNAL-UNTRACKED`
  storage lot remains hidden
- blank counted quantities mean "leave unchanged"
- completion review reveals current live stock, counted truth, and variance
  before posting

Stocktakes reconcile the `available` disposition. Blocked and rejected stock remains managed by disposition actions and is not collapsed into available by a stocktake. Location-specific counting is still not exposed in the UI; lot count rows reconcile the default location's available lot balance.

Stocktakes use the current inventory lot unit cost as valuation context. For
manufactured lots completed after standard operation costs are enabled, that lot
unit cost includes absorbed standard operation cost.

`product` scopes include all made items, including non-sellable internal products.

## Data Model

- `inventory.stocktakes` stores the header and workflow state
- `inventory.stocktake_items` stores copied item snapshots plus expected, counted, variance, applied-delta, and note fields
- `inventory.stocktake_lot_items` stores copied lot snapshots plus expected, counted, variance, applied-delta, and note fields; `is_found = true` rows are operator-added found lots, whose `lot_id` starts null

Snapshot rows must keep:

- `itemName`, `itemSku`, `itemType`, `unitName`
- `expectedQty` as the stock snapshot when the stocktake is created

This lets completed stocktakes stay readable after later item renames or soft deletes.
The live inventory truth remains the ledger and projections; `stocktake_items.expectedQty` is only the draft snapshot baseline.

## Workflow

- `draft`: counts can be edited
- `completed`: inventory has been reconciled
- `deleted`: internal state for removed draft stocktakes; hidden from normal reads

Draft stocktakes can be deleted without mutating inventory. Completed
stocktakes cannot be deleted because stocktake adjustment history must be
preserved.

### Creation, add, and copy

The new-stocktake page creates a draft from a creation mode:

- `POST /api/stocktakes` accepts `creationMode`
- `creationMode: "all"` is the friendly alias for existing `scope: "all"`
- new drafts require a non-blank `reason`, which describes why the stocktake is
  being performed
- draft users may add or remove rows after creation
- mid-draft adds snapshot expected stock at add time
- copy creates fresh snapshot rows at copy time and returns skipped deleted or
  ineligible source rows for UI warnings

### Saving counts

Saving counts updates only the stocktake snapshot rows:

- `countedQty`
- line/lot `notes`
- `varianceQty = countedQty - expectedQty`

Saving counts must not mutate live stock.

Draft saves may submit only changed item or lot lines. Clearing a saved count should submit that line with `countedQty = null`. The UI autosaves count fields on blur; there is no separate Save button.

Lot count submissions are a union. An existing lot carries its `lotLineId`; a **found lot** carries `isFound: true` with the parent `stocktakeItemId`, the entered `lotNumber`, and a required `countedQty` (no `lotLineId` — the server assigns one and may keep `lot_id` null). Found lots can only be added to lot-tracked items. A found lot count may be zero or greater; only positive variance changes stock quantity and creates the lot during completion. A found lot number must not collide with active inventory for that item: submitting one that exactly matches either a snapshotted lot or a positive-available lot is rejected (count it as the existing lot instead). Zero-balance historical lot rows are inactive and do not appear in stocktake snapshots or block found-lot entry. Lot numbers are trimmed before matching; matching is case-sensitive after trimming. Found lots are deduped per item by `(stocktakeItemId, lotNumber)`.

If a user explicitly enters the snapshot quantity, keep it as a saved count with zero variance. That still counts as progress, but it should not create a stock movement unless completion later sees a live-stock delta.

The draft detail UI should let `Complete` save pending count edits first, then run completion. This keeps the workflow one-click without adding a separate combined API contract.

For items with lot rows, the item counted total is derived from counted lot rows. Users should count specific lots instead of editing the parent item total.

### Snapshot locking

Draft stocktake creation, mid-draft add, and copy must lock the candidate `inventory.items` rows before inserting snapshot rows. Item soft-delete flows must lock those same rows before checking for draft stocktake references.

This keeps stocktake creation and item deletion from racing each other into a state where a hidden soft-deleted item still exists inside a draft stocktake.

### Completing

`GET /api/stocktakes/:id/completion-preview` returns a non-mutating review
payload for counted rows. It uses current live available stock so the displayed
variance matches what completion will attempt to post. If completion returns a
stale `409`, clients must fetch preview again, show the updated variance, and
require the user to confirm again.

Completion applies counted truth from **current live stock**, not from the old
snapshot. It uses the stocktake's stored reason for inventory event metadata.

1. lock the stocktake row
2. lock all counted items in stable order
3. read current live available stock
4. if current live available stock differs from the snapshot `expectedQty`, return `409` with a stale payload unless the caller confirmed
5. apply delta from current live available stock to `countedQty`
6. store `appliedDeltaQty`
7. mark the stocktake `completed`

This keeps stocktakes safe when purchasing, manufacturing, or manual adjustments changed stock after the stocktake started.

## Inventory Integration

Stocktake completion reuses the inventory kernel and reconciles the available bucket only:

- positive deltas create tracked date lots or append to `INTERNAL-UNTRACKED`
- negative deltas FIFO-consume tracked lots or deduct from `INTERNAL-UNTRACKED`
- positive variance writes `stocktake_gain`
- negative variance writes `stocktake_loss` per consumed lot
- zero variance writes `stocktake_verification` so the ledger can answer "when was this item last physically verified?"
- lot rows write gain/loss events to the lot and carry `stocktakeLotLineId` metadata
- positive deltas must resolve to a non-null `costPerUnit`
  - materials convert the item's current `defaultPurchasePrice` from purchase-unit price into stock-unit cost using `purchaseToStockFactor`
  - products derive cost from active BOM ingredients
  - if there is no cost basis, fail completion instead of creating a null-cost lot

Hot-path reads after completion come from `inventory_item_balances` and `inventory_lot_balances`, not by replaying the stocktake rows themselves.

Draft stocktakes block item soft deletion. Completed and deleted stocktakes do not.
