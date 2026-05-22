---
title: Manufacturing Orders
description: How Ashicore plans, releases, picks, completes, and costs production work.
section: Concepts
order: 140
---

A manufacturing order is the production document that turns a product recipe into controlled inventory movement. It snapshots what the shop intends to make, what ingredients are required, what supply will be expected, what was actually picked, and what finished stock was produced.

## Core workflow

Manufacturing has two broad phases.

Draft planning is editable. The user chooses the product, quantity, recipe, ingredient rows, and optional sales traceability. Draft orders do not create allocatable supply.

Released execution is operational. Release validates the order, creates finished-good expected supply, creates ingredient demand, and prepares the order for picking and completion.

After release, inventory history starts to matter. Picked ingredients and produced output cannot be treated like simple form fields.

## Status model

The public mental model is intentionally small:

- **Open** means the order is active operational work.
- **Done** means production output or finalized consumption has been recorded and the order is terminal.

Open orders can be planned, released, picked, or completed depending on their execution state. Done orders preserve history.

There is no "reopen completed production" workflow in v1.

## Recipe basis

Ashicore supports two recipe bases:

- **Unit recipe**: ingredient quantity is written per one finished unit.
- **Batch recipe**: ingredient quantity is written per one production batch.

For unit recipes, making 10 units multiplies each ingredient by 10.

For batch recipes, the product defines expected batch yield. Making 3 batches uses three copies of the batch ingredient list, even if actual output later differs from expected output.

Packaging such as bags, wrap, pallets, and labels are normal ingredients. V1 does not model every-N packaging rules separately.

## Release behavior

Release does not consume stock. It moves the order from planning into operational supply and demand:

- finished-product output becomes expected supply
- ingredient requirements become demand
- direct ingredient lot allocations may be recorded when the user reviewed or requested them

Release should not silently hold ingredient lots in flows that do not show a lot-review surface.

Only released manufacturing orders can be selected as future supply for sales allocation.

## Picking behavior

Picking is the ingredient stock event.

When ingredients are picked, Ashicore consumes from selected allocations first, then FIFO for any remaining quantity. The system records the consumed lots so cost and traceability survive later edits.

Discrete orders pick the full remaining ingredient quantity in v1. Batch orders pick the current batch's ingredient rows.

Picking should release the matching reservation and write manufacturing ingredient consumption history. Completion must not deduct those same ingredients again.

## Completion behavior

Completion creates finished-product stock.

For discrete orders, completion can log produced output and then close the order. The produced lot uses picked ingredient cost plus absorbed standard operation cost.

For batch orders, each completed batch creates its own finished-product lot and output event. The parent order becomes done when the final batch is complete.

Actual output may differ from planned output. That is normal production variance, not a reason to edit the historical recipe snapshot.

## Cost behavior

Manufacturing cost comes from:

- consumed ingredient lot cost
- absorbed standard operation cost from the manufacturing order snapshot

Standard operation cost is planned internal costing, not actual payroll. UI copy should call it absorbed labor or operation cost, not actual labor.

Finished-product lots carry the resulting unit cost. Sales margin later reads the lot cost through shipment consumption, so sales must not add operation cost again.

## Delete and cancellation rules

An open order can be deleted or cancelled only while its inventory effects can be reversed safely.

Deleting an open manufacturing order should release expected finished-good supply, clear active allocations, and reverse picked or reserved ingredient state in one transaction.

Completed output blocks deletion. Produced lots are history.

## Example

A product recipe says one batch yields 9 yards of soil and uses 3 yards compost, 4 yards bark, and 2 yards sand. A two-batch order plans 18 yards of output and snapshots two sets of batch ingredient demand. If the first batch produces 8.5 yards, that actual output creates a finished-product lot for 8.5 yards while the second batch remains open.

## Related docs

Read [Complete a Manufacturing Order](/docs/how-to/complete-manufacturing-order), [Create a Batch Recipe](/docs/how-to/create-batch-recipe), and [Inventory](/docs/concepts/inventory).
