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

V1 is intentionally small:

- a stocktake snapshots all active items in one scope chosen from one grouped dropdown:
  - quick scopes: `all`, `material`, or `product`
  - category scopes: one category inside `material` or `product`
- count entry happens on the stocktake detail page
- blank counted quantities mean "leave unchanged"
- completion automatically sets inventory to counted truth

Stocktakes are item-total counts only. They do not count lots individually, do not support locations, and do not have a separate review/apply phase.

Category scopes must encode both the item type and the category name in `inventory.stocktakes.scope`, for example `material:category:Soil`. This avoids ambiguous category names shared by both materials and products while keeping list/detail labels readable.

## Data Model

- `inventory.stocktakes` stores the header and workflow state
- `inventory.stocktake_items` stores copied item snapshots plus expected, counted, variance, and applied-delta quantities

Snapshot rows must keep:

- `itemName`, `itemSku`, `itemType`, `unitName`
- `expectedQty` as the stock snapshot when the stocktake is created

This lets completed stocktakes stay readable after later item renames or soft deletes.

## Workflow

- `draft`: counts can be edited
- `completed`: inventory has been reconciled
- `cancelled`: snapshot kept for history, no inventory mutation

There is no delete flow in v1.

### Saving counts

Saving counts updates only the stocktake snapshot rows:

- `countedQty`
- `varianceQty = countedQty - expectedQty`

Saving counts must not mutate live stock.

Draft saves may submit only changed lines. Clearing a saved count should submit that line with `countedQty = null`.

If a user explicitly enters the snapshot quantity, keep it as a saved count with zero variance. That still counts as progress, but it should not create a stock movement unless completion later sees a live-stock delta.

The draft detail UI should let `Complete` save pending count edits first, then run completion. This keeps the workflow one-click without adding a separate combined API contract.

### Snapshot locking

Draft stocktake creation must lock the candidate `inventory.items` rows before inserting snapshot rows. Item soft-delete flows must lock those same rows before checking for draft stocktake references.

This keeps stocktake creation and item deletion from racing each other into a state where a hidden soft-deleted item still exists inside a draft stocktake.

### Completing

Completion applies counted truth from **current live stock**, not from the old snapshot:

1. lock the stocktake row
2. lock all counted items in stable order
3. read current live stock
4. if current live stock differs from the snapshot `expectedQty`, return `409` with a stale payload unless the caller confirmed
5. apply delta from current live stock to `countedQty`
6. store `appliedDeltaQty`
7. mark the stocktake `completed`

This keeps stocktakes safe when purchasing, manufacturing, or manual adjustments changed stock after the stocktake started.

## Inventory Integration

Stocktake completion reuses the shared stock helper layer:

- positive deltas create lots
- negative deltas FIFO-consume lots
- every applied change writes a stock movement with:
  - `movementType = stocktake_adjustment`
  - `referenceType = stocktake`
  - `referenceId = <stocktake id>`
- positive deltas must resolve to a non-null `costPerUnit`
  - materials use the item's current `defaultPurchasePrice`
  - products derive cost from active BOM ingredients
  - if there is no cost basis, fail completion instead of creating a null-cost lot

Draft stocktakes block item soft deletion. Completed and cancelled stocktakes do not.
