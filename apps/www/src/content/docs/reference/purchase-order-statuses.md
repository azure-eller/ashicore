---
title: Purchase Order Statuses
description: Status definitions and transitions for purchase orders and receiving.
section: Reference
order: 330
---

## Statuses

Draft purchase orders are editable planning records. Ordered purchase orders represent expected inbound supply. Partial purchase orders have at least one receipt and at least one remaining quantity. Received purchase orders are complete.

## Allowed transitions

Draft can become ordered. Ordered can be partially received or fully received. Partial can become received when all remaining quantities are received.

## Blocked transitions

Received history should not be deleted as if it never happened. Ordered quantity should not be reduced below already received quantity. Received lines should not be removed from history.

## Related actions

Create purchase order, receive inventory, edit unreceived quantities, and delete unreceived purchase orders.
