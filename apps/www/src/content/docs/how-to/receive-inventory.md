---
title: Receive Inventory
description: Receive purchase order quantities into lot-backed stock.
section: How-to
order: 210
---

## User problem

Material has arrived, and the team needs Ashicore to reflect the physical stock now available or on hold.

## Steps

1. Open the purchase order.
2. Confirm the item, ordered quantity, remaining quantity, and unit conversion.
3. Enter the received quantity for each line that arrived.
4. Choose the lot disposition.
5. Confirm the receipt.
6. Review lots and the inventory ledger.

## System behavior

Receiving creates real inventory. It should release the matching expected supply and create a lot-backed positive stock movement with receipt-time cost.

## Edge cases

Receive partial quantities when only part of the order arrives. Use blocked disposition for stock that exists but should not be promised. Do not receive stock that has not physically arrived.

## Related docs

Read [Purchase Order Statuses](/docs/reference/purchase-order-statuses) and [Inventory](/docs/concepts/inventory).
