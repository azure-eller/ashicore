---
title: Allocation Rules
description: Precise demand, supply, movement, and cleanup rules for sales and manufacturing allocations.
section: Reference
order: 310
---

Use this page when deciding whether demand is covered, reordered, released, or physically consumed.

## Active demand

Sales allocation demand includes only non-deleted lines on confirmed or partially shipped sales orders.

Draft, shipped, cancelled, and deleted sales orders do not create active allocation demand.

Sales order line demand represents the unplanned remainder:

```text
remaining_to_ship - planned_shipment_quantity
```

Sales shipment line demand represents planned fulfillment demand.

## Eligible supply

Eligible supply can be:

- available inventory lots
- released manufacturing-order output supply

Draft manufacturing orders are excluded. They are planning work, not supply.

Blocked and rejected lots are excluded from normal allocation.

## Movement rules

Creating or increasing a planned shipment should move matching active allocations from order-line demand to shipment-line demand when possible.

Decreasing or deleting a planned shipment should move excess allocation back to order-line demand when the underlying order demand still exists.

Shipping recomputes queue coverage in the transaction, then consumes physical stock through the execution policy.

Deleting demand must release dependent allocations. Do not leave orphaned allocation rows attached to deleted sales orders, shipments, manufacturing orders, or lines.

## Quantity rules

Allocation cannot exceed eligible supply.

Allocation cannot exceed open demand for the target bucket.

Coverage should not make on-hand stock change. It changes the planning answer, not physical quantity.

Demand and physical stock should be updated through the inventory kernel. No feature should mutate availability directly.

## Planning relationship

Planning uses confirmed sales demand, released manufacturing component demand, safety stock, on-hand stock, open purchase supply, and released manufacturing supply.

Allocation is a priority decision inside that world. It does not remove the need to buy, make, receive, pick, complete, or ship.

## Troubleshooting

If an item looks short after coverage, check whether stock is blocked, claimed by earlier demand, or only expected from a draft manufacturing order.

If a shipment has no supply but the order line does, check whether allocation was moved from order-line demand to shipment-line demand when the shipment was created.

If available quantity seems too low, inspect demand-queue coverage for confirmed sales orders, planned shipments, and released manufacturing ingredient demand.

## Related docs

Read [Allocations](/docs/concepts/allocations), [Planned vs Unplanned Demand](/docs/concepts/planned-vs-unplanned-demand), and [First Sales Workflow](/docs/start-here/first-sales-workflow).
