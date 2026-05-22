---
title: Allocation Rules
description: The rules that govern reserving, moving, and releasing stock commitments.
section: Reference
order: 320
---

## Guarantee

Allocation must never promise more stock than is available for that demand path.

## Rules

Allocations reduce availability but do not reduce on-hand quantity. A demand document owns its reservations until they are consumed, moved, or released. Deleted or reduced demand should release dependent allocation.

## Blocked transitions

Do not allocate blocked stock as normal available inventory. Do not allocate more than the remaining demand. Do not leave allocation attached to a deleted demand record.

## Examples

A sales order for 10 units can be allocated 6 units now and left short 4 units. Shipping 6 units consumes the shipped stock. If the order is reduced to 4 units before shipment, the extra 2 allocated units should be released.
