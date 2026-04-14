---
read_when:
  - Planning or implementing manufacturing orders
  - Changing manufacturing status transitions or inventory effects
  - Wiring manufacturing UI, API routes, or DAL queries
  - Debugging shortages, expected quantities, produced lots, or picking flows
---

# Manufacturing Orders

## Scope

Manufacturing v1 now covers both planning and simple execution:

- one finished product per manufacturing order
- BOM ingredients stored per unit of output
- editable draft snapshots before release
- optional sales-order-line traceability
- release warning on shortage
- mobile-first execution flow with a minimal web fallback
- discrete orders picked once, then completed once
- batch-mode orders executed one batch at a time

Still excluded in v1:

- partial ingredient picks
- reverse picks / unpick
- manual lot selection
- reservations
- negative stock
- work centers, operations, labor, or overhead costing
- child manufacturing orders
- auto-created orders from sales without an explicit user action

## Workflow

Top-level statuses stay small:

- `draft`: editable; ingredient rows may be recalculated and replaced
- `released`: frozen for planning; execution happens from here
- `completed`: terminal; all discrete work or all batches are finished
- `cancelled`: terminal; does not affect stock or expected quantity

Allowed transitions:

- create -> `draft`
- `draft` -> `released`
- `released` -> `completed`
- `draft` -> `cancelled`
- `released` -> `cancelled`

No revert-to-draft in v1.

## Execution Surfaces

There are now two manufacturing experiences:

- detail pages for planning, review, history, and traceability
- execution pages for field work

Use:

- `/manufacturing/orders/[id]` for admin/detail
- `/manufacturing/execution` for the actionable queue
- `/manufacturing/orders/[id]/execute` for discrete execution

The detail page should link into execution with `Start Manufacturing` or `Continue Manufacturing`.

## Snapshot Model

Manufacturing orders still snapshot live master data at create time:

- header snapshots: product name, SKU, unit, optional sales order number, optional sales customer
- ingredient snapshots: item name, SKU, item type, unit, quantity per unit

Editing a draft manufacturing order never mutates the product BOM.

Locked BOMs are still product-level flags on `inventory.items`. Locked BOMs restrict inventory editing surfaces, but manufacturing can still snapshot and execute from them.

Manufacturing product pickers should only show products whose active BOM still has at least one non-deleted ingredient.

For quantities, store both:

- `requested_quantity`: what the user or sales line asked for
- `planned_quantity`: what execution will actually run

Discrete orders keep these values the same. Batch-mode orders may round `planned_quantity` up to full-batch output while preserving `requested_quantity`.

## Release Behavior

Release validates that:

- the product still exists and is active
- ingredient items still exist and are active
- draft ingredient rows are structurally valid

Release checks live lot-backed stock against planned ingredient quantities:

- if there is no shortage, release succeeds immediately
- if shortages exist, the first response is `409` with `{ error, shortage }`
- retrying with `confirmShortage: true` allows release

Release behavior differs by manufacturing mode:

- discrete: the existing ingredient snapshot rows remain the execution rows
- batch: release creates `manufacturing_order_batches` rows and replaces the template ingredient rows with one set of batch-specific ingredient rows per batch

Only released, non-deleted manufacturing orders contribute to `items.expectedQty`.

For batch-mode orders, expected quantity is remaining unfinished output only:

- released order contribution = `plannedQuantity - completed actual quantity`
- each completed batch reduces expected quantity immediately

## Picking Behavior

Picking is now the ingredient stock event.

When a worker picks an ingredient:

- lock the manufacturing order row first
- lock affected `inventory.items` rows
- lock FIFO candidate `inventory.lots` rows
- deduct the remaining quantity immediately
- write `inventory.stock_movements` with `movementType = manufacturing_picked`
- persist the lot allocations in `manufacturing_pick_allocations`
- update ingredient `pickedQuantity`, `pickStatus`, and `pickedAt`

Discrete picking rules:

- pick the full remaining quantity only
- no partial quantity entry in v1
- no manual lot choice in v1

Batch picking rules:

- only the current batch’s ingredient rows are actionable
- starting a batch marks it `in_progress`
- a fully picked batch records `pickedAt`

## Completion Behavior

### Discrete Orders

Discrete completion is still one-shot, but it is now pick-gated:

- user enters `actualQuantity`
- every ingredient must already be fully picked
- completion uses persisted pick allocations for quantity and cost
- completion must not deduct ingredient stock a second time
- one finished-product lot is created
- one `manufacturing_produced` movement is written
- the order stores `actualQuantity`, `actualMaterialCost`, and `actualCostPerUnit`

Discrete completion should hard-block with a domain error if any ingredient remains unpicked.

### Batch Orders

Batch-mode orders complete one batch at a time:

- worker starts the next pending batch
- picks the current batch’s ingredients
- enters the batch’s actual output
- completes that batch

Each completed batch:

- uses only that batch’s pick allocations
- writes ingredient actuals/costs for that batch’s ingredient rows
- creates one finished-product lot
- writes one `manufacturing_produced` movement
- stores the batch’s actual quantity

The parent order:

- stays `released` while any batch is `pending` or `in_progress`
- accumulates total `actualQuantity` and cost across completed batches
- becomes `completed` automatically when the final batch completes

Direct parent completion is invalid for batch-mode orders.

## Quantity and Cost Rules

Derived manufacturing quantities should be normalized to the database scale before comparing or mutating stock. Do not compare raw JavaScript float multiplication like `0.1 * 3`.

Costing is still material-only in v1:

- discrete orders derive actual material cost from picked lot allocations
- batch-mode orders derive each batch’s cost from that batch’s picked lot allocations

Labor and overhead remain excluded.

## Cancellation Behavior

Cancellation stays intentionally strict in v1:

- `draft` orders may be cancelled normally
- released discrete orders may be cancelled only before any picking begins
- released batch orders may be cancelled only before any batch starts

Once picking or batch execution has started, cancellation should fail. Reverse-pick / unwind is a future feature.

## Sales Traceability

Manufacturing may optionally link one sales order line:

- eligible lines come from non-deleted `draft` or `confirmed` sales orders
- the linked line must match the selected finished product
- the link is informational only; it does not create or complete anything in sales
- the link blocks duplicate sales-driven MO creation for that line
- linked MOs in `draft`, `released`, or `completed` keep claiming the line; only `cancelled` frees it

`salesOrderLineId` stays a snapshot reference because sales draft edits replace line rows. Draft manufacturing-order edits should preserve or relink unchanged snapshots when possible.

## Delete Guards

Inventory items cannot be soft-deleted if they are used by an active manufacturing order:

- the finished product on a `draft` or `released` order blocks delete
- any ingredient row on a `draft` or `released` order blocks delete

Completed and cancelled manufacturing orders rely on snapshots for history, so item deletion may proceed once no active manufacturing order references the item.
