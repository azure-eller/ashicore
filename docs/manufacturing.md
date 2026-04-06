---
read_when:
  - Planning or implementing manufacturing orders
  - Changing manufacturing status transitions or inventory effects
  - Wiring manufacturing UI, API routes, or DAL queries
  - Debugging shortages, expected quantities, or produced lots
---

# Manufacturing Orders

## Scope

Manufacturing v1 is intentionally small:

- one finished product per order
- BOM ingredients stored per unit of output
- editable draft snapshot before release
- optional sales-order-line traceability
- release warning on shortage
- one-shot completion with FIFO consumption and one produced lot

Explicitly excluded in v1:

- batch tracking
- partial completions
- reservations
- negative stock
- work centers, labor, or overhead costing
- child manufacturing orders
- auto-created orders from sales

## Workflow

Statuses:

- `draft`: editable; ingredient rows may be recalculated and replaced
- `released`: frozen; contributes to `items.expectedQty`
- `completed`: terminal; records actuals, material cost, and produced lot
- `cancelled`: terminal; does not affect stock or expected quantity

Allowed transitions:

- create -> `draft`
- `draft` -> `released`
- `released` -> `completed`
- `draft` -> `cancelled`
- `released` -> `cancelled`

No revert-to-draft in v1.

## Snapshot Model

Manufacturing orders copy live master data into snapshots at create time:

- header snapshots: product name, SKU, unit, optional sales order number, optional sales customer
- ingredient snapshots: item name, SKU, item type, unit, quantity per unit

The product BOM is the source of truth for creating the draft, but the draft order owns its copied ingredient rows after creation. Editing a draft manufacturing order never mutates the product BOM.

Locked BOMs are a product-level flag on `inventory.items`, not a separate BOM header object. Locking a BOM restricts general recipe view/edit surfaces in inventory, but it does not block manufacturing-order creation, release, or completion. Manufacturing continues to snapshot the live BOM rows for execution even when the source BOM is locked.

Manufacturing product pickers should only show products whose filtered BOM still has at least one active ingredient. If deleted items are removed from the BOM snapshot query, drop products whose remaining ingredient list is empty so the form never offers an unbuildable template.

## Release Behavior

Release validates that:

- the product still exists and is active
- ingredient items still exist and are active
- draft ingredient rows are structurally valid

Release checks live lot-backed stock against planned ingredient quantities:

- if there is no shortage, release succeeds immediately
- if shortages exist, the first response is `409` with `{ error, shortage }`
- retrying with `confirmShortage: true` allows release

Only released, non-deleted manufacturing orders contribute to `items.expectedQty`.

## Completion Behavior

Completion is one-shot:

- user enters `actualQuantity`
- each ingredient actual is derived as `quantityPerUnit * actualQuantity`
- shortages at completion hard-block the operation before any lot mutation

Derived manufacturing quantities should be normalized to the database scale before comparing or mutating stock. Do not compare raw JavaScript float multiplication like `0.1 * 3`, because values such as `0.30000000000000004` can trigger false shortages or slightly oversized deductions. Round to 4 decimals first, then use that normalized number for both shortage checks and FIFO consumption.

On successful completion:

- ingredient lots are consumed FIFO
- `inventory.stock_movements` rows are written with `movementType = manufacturing_consumed`
- actual material cost is derived from consumed lot costs
- one positive finished-product lot is created
- one `manufacturing_produced` movement is written for that lot
- the order stores `actualQuantity`, `actualMaterialCost`, and `actualCostPerUnit`
- `items.expectedQty` is recomputed so the released demand is removed

Material costing in v1 is material-only. Labor and overhead are intentionally excluded.

## Sales Traceability

Manufacturing may optionally link one sales order line:

- eligible lines come from non-deleted `draft` or `confirmed` sales orders
- the linked line must match the selected finished product
- the link is informational only; it does not create or complete anything in sales
- the link blocks duplicate sales-driven MO creation for that line; a cancelled linked MO is required before another one can be created
- linked MOs in `draft`, `released`, or `completed` keep claiming the line; only `cancelled` frees it

`salesOrderLineId` is stored as a snapshot reference because sales draft edits replace line rows. Draft manufacturing-order edits should therefore keep working when the original line id goes stale:

- if the submitted line id still resolves to an active matching line, use it
- if the user left the existing snapshot unchanged and the sales order now has a replacement line for the same product, relink to that current line
- if the user left the existing snapshot unchanged and no active replacement exists, preserve the stored snapshot instead of blocking the draft edit

Only newly selected or changed links should fail validation when they do not point to an active matching sales line.

## Delete Guards

Inventory items cannot be soft-deleted if they are used by an active manufacturing order:

- the finished product on a `draft` or `released` order blocks delete
- any ingredient row on a `draft` or `released` order blocks delete

Completed and cancelled manufacturing orders rely on snapshots for history, so item deletion may proceed once no active manufacturing order references the item.
