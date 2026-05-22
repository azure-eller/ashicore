---
title: Allocations
description: How Ashicore reserves usable stock or released production supply for specific demand.
section: Concepts
order: 120
---

Allocation answers one question: "who is this supply for?" It does not create stock, receive stock, pick stock, or ship stock. It holds usable supply against active demand so the same quantity is not promised twice.

## Demand buckets

Sales has two demand buckets:

- **Sales order line demand** is the unplanned remainder of a confirmed or partially shipped order.
- **Sales shipment line demand** is demand tied to a planned shipment.

When a planned shipment is created or increased, Ashicore can move matching allocations from the order-line bucket into the shipment-line bucket. When a planned shipment is decreased or deleted, excess allocation moves back to the order-line bucket.

This matters because planned shipments are the physical fulfillment plan. Shipment-specific allocation should win over generic order allocation.

## Supply sources

Allocations can come from:

- available inventory lots
- released manufacturing orders that represent unfinished expected finished-good supply

Draft manufacturing orders are planning work only. They are not allocatable supply because the shop has not released them into the operating plan.

Blocked or rejected lots should not be allocated as normal supply.

## Workflow

Use allocation when a customer order, shipment, or production plan deserves priority over other demand.

1. Open the allocation surface from sales or planning.
2. Review active demand and current shortages.
3. Choose the demand bucket that should receive supply.
4. Allocate from available lots or released manufacturing supply.
5. Recheck the remaining shortage and downstream plan.

If the order changes, release or move the allocation. Do not leave old reservations attached to stale quantities.

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
- draft sales orders and draft manufacturing orders must not reserve real supply

## Example

A confirmed sales order needs 20 bags. Ten bags are on hand and another 15 are expected from a released manufacturing order. The allocator can reserve the 10 available bags and optionally reserve future supply from the released manufacturing order. If the user creates a planned shipment for 8 bags, the relevant reservation moves from the order-line bucket to the shipment-line bucket so shipping has a precise supply plan.

## Related docs

Read [Allocation Rules](/docs/reference/allocation-rules), [Sales Fulfillment](/docs/start-here/first-sales-workflow), and [Planned vs Unplanned Demand](/docs/concepts/planned-vs-unplanned-demand).
