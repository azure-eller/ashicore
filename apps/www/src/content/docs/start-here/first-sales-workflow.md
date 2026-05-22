---
title: First Sales and Shipping Workflow
description: Create customer demand, allocate stock, and ship only what is physically available.
section: Start here
order: 40
---

This workflow proves that Ashicore can reserve stock for a customer and keep that demand separate from other orders.

## User problem

The team needs to know whether a customer order can be fulfilled now, what stock is promised, and what still needs purchasing or production.

## Workflow

1. Create or confirm finished product stock.
2. Create a customer.
3. Create a sales order with product lines.
4. Review availability.
5. Allocate stock to the order.
6. Ship the quantity that physically leaves.
7. Review the item balance and ledger.

## System behavior

Allocation reserves available stock for demand. Shipping records the physical stock movement. A sales order should not make inventory disappear until a shipment is recorded.

## Checks

Available stock should fall when stock is allocated. On-hand stock should fall when stock ships. Remaining demand should stay visible if the order is only partially fulfilled.
