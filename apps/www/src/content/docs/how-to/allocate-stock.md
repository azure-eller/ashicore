---
title: Allocate Stock
description: Reserve available inventory for customer or production demand.
section: How-to
order: 220
---

## User problem

The team needs to decide which order or job gets scarce stock.

## Steps

1. Open the allocation workspace or demand view.
2. Review available quantity, existing commitments, blocked stock, and expected supply.
3. Select the demand that should receive stock.
4. Allocate from available stock.
5. Review remaining shortages.
6. Release or move allocations if priorities change.

## System behavior

Allocation reduces available stock without reducing on-hand stock. The physical quantity changes later through shipment or manufacturing consumption.

## Edge cases

If availability is lower than expected, check blocked lots, other commitments, and open demand. If a document is deleted or reduced, dependent allocation should be released.
