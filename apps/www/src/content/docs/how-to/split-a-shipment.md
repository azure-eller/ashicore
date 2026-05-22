---
title: Split a Shipment
description: Fulfill only part of a customer order while keeping remaining demand visible.
section: How-to
order: 250
---

## User problem

The customer order cannot ship all at once, but the team still needs to ship what is ready and preserve the remaining demand.

## Steps

1. Open the sales order.
2. Review allocated and available stock.
3. Select the lines and quantities that will physically leave now.
4. Create or confirm the shipment.
5. Ship the selected quantities.
6. Review the remaining open demand.

## System behavior

Shipment reduces on-hand stock for the shipped quantity. Remaining unshipped quantity stays on the order so it can be allocated and shipped later.

## Edge cases

If allocation was tied to the original demand, the split shipment needs clear reservation behavior. Do not ship quantities that are not physically leaving.
