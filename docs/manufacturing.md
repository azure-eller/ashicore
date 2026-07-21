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
- BOM ingredients stored per recipe basis
- editable draft snapshots before release
- optional sales-order-line traceability
- release without shortage confirmation
- mobile-first execution flow through the Android app
- discrete orders picked once, then completed once
- batch-mode orders executed one batch at a time
- ingredient lot choice at pick time
- universal partial output through the execution API/mobile workflow, without a product-level mode

Still excluded in v1:

- partial ingredient picks
- work-center scheduling, operation statuses, or actual labor time tracking
- child manufacturing orders
- auto-created orders from sales without an explicit user action

The inventory kernel now provides demand release and unpick semantics for manufacturing, but the UI still keeps execution flows narrow and guided.

## Workflow

Top-level statuses stay small:

- `open`: editable operational work; execution may have reversible picked ingredients and open ingredient demand
- `done`: production output or finalized consumption has been recorded; the status dropdown can move it back to Work in progress for discrete or batch, make-to-stock or linked make-to-order work. Reopening reverses the completion's stock and cost effects through compensating kernel events, settles consumed pick allocations by their recorded lot, location, and cost layer, resets completed batches, restores ingredient demand and expected output to the full plan targets, and returns the order to the end of the open priority queue (`lib/manufacturing/queries/reopen.ts`). The reopened order remains execution-started, so planning fields stay locked. The reversal fails atomically when produced stock has since shipped or been consumed. Reopening and completing again must produce one net live set of output, consumption, and cost effects.

Open-order editing is split by risk:

- planned dates, notes, blocked state, and other non-inventory metadata may be edited while the order is open; status changes first require pending valid card edits to save
- production quantity, product, ingredient snapshot, batch shape, and operation-cost planning may only be edited before execution starts
- execution has started once the order is started, any batch leaves `pending`, any ingredient is picked or has actuals, or output is recorded
- make-to-order manufacturing linked to a sales order line must keep the linked product, quantity, and sales line identity

Allowed transitions:

- create -> `open`
- `open` -> `done`
- `done` -> `open` (the reopen transition above)
- soft-delete `open` (blocked while net recorded output is positive; a fully
  reversed reopened order can be deleted, which also frees a linked sales line)

Only `open` and `done` are persisted top-level statuses. Elsewhere this doc uses
execution-phase words for an open order: *draft* (before release) and *released*
(after release); *complete* means the transition to `done`, and *cancel* means
soft-deleting an open order.

Deleting an open manufacturing order releases expected supply and ingredient
demand, and reverses picked ingredient state in the same
transaction. Done orders and orders with net-positive production output block
deletion because production history must be preserved. After a successful
reopen fully reverses that output, the open order can be deleted.

## Priority Ranking

Manufacturing orders may have an optional `priorityRank`:

- `1` is the highest priority
- only positive whole numbers are valid
- unranked orders stay unranked and sort after ranked work
- draft and released orders may be ranked or reprioritized
- completed orders leave the open queue; reopening appends them at its end

Ranking changes demand queue order. It does not directly mutate inventory, costing, Xero, shipments, or status transitions.

## Execution Surfaces

There are two manufacturing experiences:

- detail pages for planning, review, history, and traceability
- Android execution for field work

Use:

- `/manufacturing/orders/[id]` for admin/detail
- Android for pick/start-batch/complete execution workflows
- `/api/manufacturing-orders/[id]/execution` and related execution endpoints as the mobile/API contract
- `POST /api/manufacturing-orders/[id]/reopen` for the idempotent Done-to-Work-in-progress reversal

The web app must not expose a `/manufacturing/orders/[id]/execute` workflow. Web detail/list
surfaces can change simple status metadata and complete output through the shared status
control, but guided field execution belongs to mobile/API clients.

## Snapshot Model

Manufacturing orders still snapshot live master data at create time:

- header snapshots: product name, SKU, unit, optional sales order number, optional sales customer
- ingredient snapshots: item name, SKU, item type, unit, quantity used, consumption mode, basis, selected batch/group policy, calculated batch/group count, and planned quantity

Editing a draft manufacturing order never mutates the product BOM.

Locked BOMs are still product-level flags on `inventory.items`. Locked BOMs restrict inventory editing surfaces, but manufacturing can still snapshot and execute from them.

Manufacturing product pickers should only show products whose active BOM still has at least one non-deleted ingredient.

For quantities, store both:

- `requested_quantity`: what the user or sales line asked for
- `planned_quantity`: what execution will actually run

Discrete orders keep these values the same. Batch-mode orders are created from a
whole-number batch count and planned output; `number_of_batches` drives
ingredient demand, while `planned_quantity` is the expected finished output.
`expected_batch_yield` is the order-level planned output divided by batch count.
Demand-created orders still preserve the requested quantity separately.

## Recipe Basis

There are only two recipe bases:

- `unit`: ingredient quantities are authored per 1 finished unit
- `batch`: ingredient quantities are authored per 1 production batch

Core invariant:

- Unit recipes scale by finished output quantity.
- Batch recipes scale by number of batches.

Batch product setup stores `recipe_basis = 'batch'` on the BOM revision and `output_quantity = expected_batch_yield`. BOM line `quantity` means quantity per batch. Pallets, wrap, labels, and other packaging materials are ordinary ingredient lines. V1 does not model every-N packaging rules or remainder choices.

MO creation snapshots concrete ingredient quantities on `manufacturing_order_ingredients`. Historical MOs should display and execute from the snapshot, not from the current product BOM.

Estimated unit cost uses average per-output consumption. For batch recipes this is `line.quantity / bom.output_quantity`.

A product BOM cannot include the product itself as a component. Component
quantities must be positive, and minimum lot-age constraints must be blank or a
positive whole number of days.

## Standard Operation Costs

Standard operation costs are internal margin-costing rows attached to BOM revisions. They are not a shop-floor workflow engine.

Resources live in `manufacturing.resources` and store a loaded hourly rate. BOM operation costs live in `inventory.bom_revision_operation_costs` with:

- `per_output_unit`: crew size × minutes × rate for each finished unit
- `fixed_per_mo`: crew size × minutes × rate once for the manufacturing order

Operation cost rows snapshot `resourceName`, `resourceType`, `loadedCostPerHour`, planned crew size, planned minutes, and planned total cost. If a resource rate changes later, existing BOM revisions and manufacturing orders keep their saved rate snapshots.

Deleting a manufacturing resource archives it for future selection. Existing
BOM revision operation-cost snapshots keep their resource name, type, and rate;
manufacturing order operation-cost snapshots keep their copied operation cost
details with the live resource link detached.

Manufacturing notification resource filters use active `manufacturing.resources` rows as the configurable source of truth. Manufacturing order operation-cost snapshots provide event context for a created MO, but deleted resources and historical snapshot-only names are not independently configurable notification identities.

MO creation snapshots the current BOM operation rows into `manufacturing.manufacturing_order_operation_costs`. MO completion absorbs the snapshotted standard operation cost into produced inventory through the inventory kernel's `overheadCostTotal` input. Sales margins then pick up labor/operation cost through lot cost; sales must not add operation cost again.

The produced-today projection sums signed output rows per order for the organisation day. A same-day completion reversal therefore nets the order to zero and removes it from the report; a later completion contributes only its net positive output.

Partial output absorbs fixed-per-MO cost incrementally up to the planned total.
Final completion absorbs any remaining fixed-per-MO cost, even when actual
output is below planned quantity.

For product estimated unit cost previews, fixed operation costs are spread over the first available denominator:

1. `expectedBatchYield`
2. `typicalBatchSize`
3. `standardCostQuantity`

If none is available, fixed operation cost can be shown as a per-MO amount but not a reliable unit cost.

This is internal operational costing only. It does not create payroll, Xero, AP, GL, or inventory-valuation accounting entries.

## Release Behavior

Release validates that:

- the product still exists and is active
- ingredient items still exist and are active
- draft ingredient rows are structurally valid

Release does not warn on current ingredient shortages. It records planned
ingredient demand and expected finished-good supply immediately.
Picking remains the stock-consuming step and may warn/require confirmation for
negative stock, higher-priority demand conflicts, or lot eligibility/readiness
requirements.

Release behavior differs by manufacturing mode:

- discrete: the existing ingredient snapshot rows remain the execution rows
- batch: release creates `manufacturing_order_batches` rows and replaces the template ingredient rows with one set of batch-specific ingredient rows per batch

Only released, non-deleted manufacturing orders contribute to expected supply projections.

Only released manufacturing orders contribute expected supply in demand coverage. Draft manufacturing orders remain editable planning snapshots and must not be treated as sales supply.

On release, manufacturing now does two inventory-side things through the kernel:

- emits `expected_increase` for the finished-product output side
- emits `demand_increase` for the ingredient side

MO release does not choose or hold ingredient lots. Lot selection happens during
the pick flow. Lot-untracked ingredients still consume internal available lots
FIFO through the inventory kernel when picked.

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
- persist the lot allocations in `manufacturing_pick_allocations`
- update ingredient `pickedQuantity`, `pickStatus`, and `pickedAt`

Discrete picking rules:

- pick the full remaining quantity only
- no partial quantity entry in v1
- consume picked lot rows first, then FIFO for any unpicked remainder

Batch picking rules:

- only the current batch’s ingredient rows are actionable
- starting a batch marks it `in_progress`
- a fully picked batch records `pickedAt`

## Material Variant Swaps

Material alternates may exist in historical BOM data, but the current setup UI
does not expose explicit alternate lists. A BOM line stores one concrete item
variant as the default ingredient. While planning a manufacturing order, users
may swap that ingredient only to another active variant in the same item family.
The swap preserves the submitted quantity; users edit quantity directly when a
different package size needs a different amount.

Released execution does not change materials. Picking consumes the ingredient on the order row through the normal inventory kernel flow, and completion still requires all ingredients to be picked first.

## Batch Output Overrides

Batch yield changes live on the manufacturing order. Users edit the order's
expected output while keeping the batch count explicit, so ingredient demand
continues to scale from batch count and finished-good expected supply comes from
the order's planned output.

## Completion Behavior

### Discrete Orders

Discrete completion can be done incrementally from the execution screen:

- every released order can log produced output before closing
- the first output creates the produced lot; later output appends to that same lot
- logged output consumes ingredients proportionally to planned output
- the order remains `released` until the worker closes it

One-shot completion remains available as the complete-all path:

- user enters `actualQuantity`
- every ingredient must already be fully picked
- completion uses persisted pick allocations for quantity and cost
- completion must not deduct ingredient stock a second time
- one finished-product lot is created with `available` or `blocked` disposition
- one `manufacturing_output` event is written
- completion releases the output-side expected supply
- completion releases any remaining ingredient demand for the order
- the order stores `actualQuantity`, `actualMaterialCost`, and `actualCostPerUnit`

For lot-untracked finished products, output still creates an internal lot for
costing and audit, but all outputs append to the hidden `INTERNAL-UNTRACKED`
lot. Blocked output is rejected and the normal UI must not show lot controls.

Discrete completion should hard-block with a domain error if any ingredient remains unpicked.

### Batch Orders

Batch-mode orders may be executed one batch at a time:

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

Lot-untracked batch outputs follow the same internal-lot rule as discrete
outputs: available-only, hidden from normal lot UI, and FIFO-backed downstream.

The parent order:

- stays `open` while any batch is `pending` or `in_progress`
- accumulates total `actualQuantity` and cost across completed batches
- becomes `done` automatically when the final batch completes
- releases any remaining ingredient demand when the final batch completes

Direct parent completion is valid for batch-mode orders. It completes every remaining
batch at its planned remaining output in one API request, using the same output and
batch-completion paths as sequential execution.

## Quantity and Cost Rules

Derived manufacturing quantities should be normalized to the database scale before comparing or mutating stock. Do not compare raw JavaScript float multiplication like `0.1 * 3`.

Costing combines material cost and absorbed standard operation cost:

- discrete orders derive actual material cost from picked lot allocations
- batch-mode orders derive each batch’s cost from that batch’s picked lot allocations
- operation cost is planned/standard crew cost from the MO snapshot
- completed legacy orders without operation snapshots have `actualOperationsCost = 0`
- open or not-yet-costed orders may have `actualOperationsCost = NULL`

Use “absorbed labor / operation cost” in UI copy. Do not call this actual labor unless actual time tracking exists.

## Cancellation Behavior

Cancellation is inventory-aware:

- `draft` orders may be cancelled normally
- released discrete orders may be cancelled; picked ingredient quantities are unpicked back to their original lots through `unpick_restock`
- released batch orders may be cancelled before production output; picked ingredient quantities are unpicked back to their original lots through `unpick_restock`

Released cancellation also:

- releases any remaining ingredient demand
- releases the output-side expected supply

Orders with net-positive produced output cannot be cancelled. A successfully
reopened order has fully reversed output and can be cancelled normally.

## Sales Traceability

Manufacturing may optionally link one sales order line:

- eligible lines come from non-deleted, open sales orders
- the linked line must match the selected finished product
- the link is informational only; it does not create or complete anything in sales
- the link blocks duplicate sales-driven MO creation for that line
- a linked MO keeps claiming the line while it exists (open or done); deleting (cancelling) the MO frees it
- reopening a linked MO preserves the link and restores the open-MO quantity edit lock on the sales line

`salesOrderLineId` stays a snapshot reference because sales draft edits replace line rows. Draft manufacturing-order edits should preserve or relink unchanged snapshots when possible.

## Delete Guards

Inventory items cannot be soft-deleted if they are used by an active manufacturing order:

- the finished product on an open order blocks delete
- any ingredient row on an open order blocks delete

Done or deleted manufacturing orders rely on snapshots for history, so item deletion may proceed once no active manufacturing order references the item.
