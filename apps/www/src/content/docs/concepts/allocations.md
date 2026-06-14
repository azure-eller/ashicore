---
title: Allocations
description: How Ashicore reserves usable stock or released production supply for specific demand.
section: Concepts
order: 120
---

Allocation answers one question: "who is this supply for?" It does not create stock, receive stock, pick stock, or ship stock. It holds usable supply against active demand so the same quantity is not promised twice.

## Demand buckets

Sales has two demand buckets:

- **Sales order line demand** is the unplanned remainder of an open sales order.
- **Sales shipment line demand** is demand tied to a planned shipment.

When a planned shipment is created or increased, Ashicore can move matching allocations from the order-line bucket into the shipment-line bucket. When a planned shipment is decreased or deleted, excess allocation moves back to the order-line bucket.

This matters because planned shipments are the physical fulfillment plan. Shipment-specific allocation should win over generic order allocation.

## Supply sources

Allocations can come from:

- available inventory lots
- released manufacturing orders that represent unfinished expected finished-good supply

Unreleased manufacturing orders are planning work only. They are not allocatable supply because the shop has not released them into the operating plan.

Blocked or rejected lots should not be allocated as normal supply.

## Workflow

Use allocation when a customer order, shipment, or production plan deserves priority over other demand.

1. Open the allocation surface from sales or planning.
2. Review active demand and current shortages.
3. Choose the demand bucket that should receive supply.
4. Allocate from available lots or released manufacturing supply.
5. Recheck the remaining shortage and downstream plan.

If the order changes, update the demand quantity or priority. Do not leave stale planning state attached to old quantities.

## What allocation does not mean

Allocated stock is not shipped. It still exists until a shipment consumes it.

Allocated manufacturing supply is not finished stock. It is a promise against a released order's expected output.

Allocation is not a substitute for receiving, picking, completing, or shipping. Those workflows are the ones that write physical stock movements.

## System behavior

Allocation writes must preserve these invariants:

- allocation cannot exceed eligible supply
- allocation cannot remain attached to deleted demand
- shipment allocation must track planned shipment quantity changes
- deleting an order, shipment, or manufacturing order must release dependent active allocations
- done or deleted sales orders and unreleased manufacturing orders must not claim real supply

## Example

An open sales order needs 20 bags. Ten bags are on hand and another 15 are expected from a released manufacturing order. The demand queue covers the highest-priority demand first and marks the rest as expected or short. If priority changes, coverage recalculates from the queue instead of moving persisted planning claims.

## Related docs

Read [Allocation Rules](/docs/reference/allocation-rules), [Sales Fulfillment](/docs/start-here/first-sales-workflow), and [Planned vs Unplanned Demand](/docs/concepts/planned-vs-unplanned-demand).
