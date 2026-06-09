---
title: Inventory
description: The lot, ledger, cost, demand, and projection model behind every stock movement.
section: Concepts
order: 110
---

Inventory is the shared truth behind Ashicore. It is used by purchasing, manufacturing, sales, planning, stocktakes, and margin reporting. Treat it as an accounting-grade operating ledger, not as a field that can be edited until the number looks right.

## Mental model

Inventory has three layers:

- **Documents** explain why stock should change: purchase orders, manufacturing orders, sales shipments, stocktakes, and adjustments.
- **Ledger events** record what actually changed: receipts, consumption, output, demand changes, expected-supply changes, stocktake gains, and stocktake losses.
- **Projections** make the system fast: item balances, lot balances, demand quantity, expected quantity, and physical availability.

Users mostly see documents and projections. The ledger is what makes the answer auditable.

## Quantity vocabulary

On-hand quantity is physical stock that exists in the system.

Available quantity is physical stock eligible for use. Planning coverage decides which demand can use it.

Covered quantity is the demand-queue result for active sales or production demand.

Expected quantity is inbound supply from ordered purchase orders or released manufacturing orders.

Shortage is the gap after on-hand stock, expected supply, and demand are netted by planning.

Do not use these words interchangeably. Most inventory confusion starts when "on hand" is used to mean "available."

## Lots and dispositions

Every real stock layer lives in a lot. Lots carry quantity, cost, source history, and disposition.

Available lots can be allocated, picked, shipped, or counted.

Blocked lots exist physically but should not be promised. Use blocked when material arrived but needs inspection, rework, quarantine, or management review.

Rejected stock should stay out of promiseable inventory. It represents stock that exists or existed operationally but should not be used as normal supply.

## Cost behavior

Material receipts create lots at receipt-time stock-unit cost. Purchase-unit prices are converted into stocking-unit cost using the item's purchase-to-stock factor. Landed costs marked as distributed become part of inventory cost. Additional costs marked as not distributed affect purchase order totals but do not change lot cost.

Manufacturing output creates finished-product lots from consumed ingredient lot costs plus absorbed standard operation cost when the product recipe has operation-cost rows.

Sales margin uses actual consumed lot cost after shipping. A draft shipment can show estimated margin, but shipped margin comes from real consumption history.

## What changes inventory

These workflows write inventory history:

- purchase receipt
- manufacturing ingredient pick
- manufacturing output completion
- sales shipment
- stocktake completion
- approved inventory correction or disposition movement

These workflows should not directly change on-hand stock:

- drafting a purchase order
- drafting a manufacturing order
- creating a sales order
- editing a description, SKU, or customer name
- deleting a draft document before it has inventory history

## Safety rules

Stock, lots, costs, demand, expected supply, dispositions, and physical execution must go through the canonical inventory paths. A feature should never "just update quantity."

Draft records can usually be changed freely. Once a record has created expected supply, open demand, picked ingredients, received lots, shipped lots, or produced output, the system must clean up dependent projections in the same transaction or block the edit.

## Example

A supplier sends 325 gallons of binder at $250 per tote. The item stocks in gallons, so receipt cost is $250 / 325 = $0.769231 per gallon before landed cost.

The receipt creates a lot. Manufacturing later picks 40 gallons from that lot. The pick consumes quantity and carries the lot cost into the manufacturing order. When the finished product is completed, the product lot carries material cost plus any absorbed operation cost. When sales ships that product lot, margin uses the actual product lot cost.

## Related docs

Read [Allocation Rules](/docs/reference/allocation-rules), [Receive Inventory](/docs/how-to/receive-inventory), [Manufacturing Orders](/docs/concepts/manufacturing-orders), and [Inventory Statuses](/docs/reference/inventory-statuses).
