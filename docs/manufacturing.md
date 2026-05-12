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
- universal partial output from the execution screen, without a product-level mode

Still excluded in v1:

- partial ingredient picks
- manual lot selection
- work centers, operations, labor, or overhead costing
- child manufacturing orders
- auto-created orders from sales without an explicit user action

The inventory kernel now provides reservation and unpick semantics for manufacturing, but the UI still keeps execution flows narrow and guided.

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

Cancelling a released batch order preserves completed batch output. Non-completed
batches are cancelled with the parent order; any picked ingredients for those
batches are unpicked and returned to stock, and remaining reservations/expected
supply are released. Fully completed orders cannot be cancelled.

## Priority Ranking

Manufacturing orders may have an optional `priorityRank`:

- `1` is the highest priority
- only positive whole numbers are valid
- unranked orders stay unranked and sort after ranked work
- draft and released orders may be ranked or reprioritized
- completed and cancelled orders keep their historical rank but cannot be changed

Ranking only changes queue order. It does not affect inventory, reservations, costing, Xero, shipments, or status transitions.

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

Discrete orders keep these values the same. Batch-mode orders may round `planned_quantity` up to full-batch output while preserving `requested_quantity`. Manual batch entry may use decimal batch counts; execution still stores an integer row count and scales the final batch's planned output and ingredients.

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

Only released, non-deleted manufacturing orders contribute to expected supply projections.

On release, manufacturing now does two inventory-side things through the kernel:

- emits `expected_increase` for the finished-product output side
- emits `reservation_increase` for the ingredient side

For batch-mode orders, expected supply is remaining unfinished output only:

- released order contribution = `plannedQuantity - completed actual quantity`
- each completed batch reduces expected supply immediately

## Picking Behavior

Picking is now the ingredient stock event.

When a worker picks an ingredient:

- lock the manufacturing order row first
- lock affected `inventory.items` rows
- lock FIFO candidate `inventory.lots` rows
- deduct the remaining quantity immediately
- write one `manufacturing_ingredient_consumption` event per consumed lot
- emit `reservation_release` for the picked ingredient quantity
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

## Material Alternates

Material alternates may exist in historical BOM data, but the current planning UI does not expose alternate selection. Planners adjust the manufacturing order's actual ingredient rows when a job needs a different material.

Released execution does not change materials. Picking consumes the ingredient on the order row through the normal inventory kernel flow, and completion still requires all ingredients to be picked first.

## Completion Behavior

### Discrete Orders

Discrete completion can be done incrementally from the execution screen:

- every released order can log produced output before closing
- the first output creates the produced lot; later output appends to that same lot
- logged output consumes ingredients proportionally to planned output
- the order remains `released` until the worker closes it
- the mobile MO execution handoff at `/home/aeller/Downloads/mobile MO execution.zip` is the UI source of truth; implement Option A only

One-shot completion remains available as the complete-all path:

- user enters `actualQuantity`
- every ingredient must already be fully picked
- completion uses persisted pick allocations for quantity and cost
- completion must not deduct ingredient stock a second time
- one finished-product lot is created with `available` or `blocked` disposition
- one `manufacturing_output` event is written
- completion releases the output-side expected supply
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
- creates one finished-product lot with `available` or `blocked` disposition
- writes one `manufacturing_output` event
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

Cancellation is inventory-aware:

- `draft` orders may be cancelled normally
- released discrete orders may be cancelled; picked ingredient quantities are unpicked back to their original lots through `unpick_restock`
- released batch orders may be cancelled only before any batch starts

Released cancellation also:

- releases any remaining ingredient reservations
- releases the output-side expected supply

Started batch orders still cannot be cancelled in v1.

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
