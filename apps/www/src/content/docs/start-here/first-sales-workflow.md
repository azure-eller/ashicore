---
title: First Sales Workflow
description: Create customer demand, plan fulfillment, allocate stock, ship, and preserve shipment history.
section: Start here
order: 40
---

Sales is where customer demand becomes operational demand. A sales order is the commercial object. A shipment is the physical fulfillment object. Keep those separate and the rest of the workflow becomes easier to reason about.

## Create the order

Start with the customer, project or job if relevant, line items, ordered quantities, requested dates, and prices.

Saved orders snapshot customer, item, SKU, and unit names. That means historical orders remain readable even if a customer or item is renamed later.

Draft or open orders can be edited while they have no shipped fulfillment history. Once stock has shipped, the order becomes history-driven.

## Confirm demand

Confirmed or partially shipped sales order lines contribute committed demand. Draft, shipped, cancelled, and deleted orders should not create open allocation demand.

Ashicore allows overselling at order-entry time. The stock-consuming step is shipping, not order creation. This keeps sales entry fast while preserving inventory truth.

## Plan shipments

A planned shipment is a slice of the sales order that the team intends to fulfill physically.

Use planned shipments when an order will ship in parts, ship on different dates, or needs a bill of lading before loading.

Planned quantities must not exceed remaining line quantity. Deleting or reducing a planned shipment should move any excess shipment-specific allocation back to the order-line demand bucket.

## Allocate supply

Allocation reserves usable supply for the order or shipment. Allocate available lots when finished goods are on hand. Allocate released manufacturing supply when production is expected but not completed yet.

Allocation does not ship stock. It only prevents the same supply from being promised elsewhere.

## Ship

Shipping is the sales stock event.

When a shipment is shipped, Ashicore consumes lot-backed stock for the shipped quantities and writes sales consumption inventory history. Non-final shipments leave the order partially shipped. The final shipment closes fulfillment.

Shipped shipments are immutable because they represent physical history. Shipment costs and customer freight recovery may remain editable because they affect margin reporting but do not rewrite inventory movement.

## Margin

Draft shipment margin may use estimated item cost. Shipped shipment margin uses actual FIFO consumed lot cost from sales consumption events.

Formula:

```text
product revenue + freight recovery - product COGS - shipment costs = contribution margin
```

Customer freight recovery is reporting context in v1. It is not an automatic accounting invoice line.

## Delete behavior

Deleting an open, unshipped order can remove planned shipments, release active allocations, and delete linked open manufacturing orders created specifically for that sales order.

Shipped fulfillment, finalized invoices, accounting push history, completed manufacturing output, or finalized inventory consumption should block deletion.

## Example

A customer orders 25 bags. Ten bags are available now and 15 are expected from a released manufacturing order. The team creates a planned shipment for 10 bags this week and allocates the available lot to that shipment. The remaining 15 bags stay as open order-line demand until production finishes or a second planned shipment is created.

## Related docs

Read [Allocations](/docs/concepts/allocations), [Split a Shipment](/docs/how-to/split-a-shipment), [Allocation Rules](/docs/reference/allocation-rules), and [Delete Rules](/docs/reference/delete-rules).
