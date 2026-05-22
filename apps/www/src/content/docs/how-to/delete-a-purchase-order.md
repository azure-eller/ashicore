---
title: Delete a Purchase Order
description: Remove purchase order records only when inventory history can remain correct.
section: How-to
order: 260
---

## User problem

A purchase order was created by mistake or is no longer valid, and the team wants it gone without corrupting stock history.

## Steps

1. Open the purchase order.
2. Check the status.
3. Confirm whether any quantity has been received.
4. Delete only if the order has no protected receipt history.
5. Confirm that expected supply is released.

## System behavior

Deleting an unreceived ordered purchase order should release expected supply. Partially received or received history must be protected because inventory lots and ledger events already exist.

## Dialogs and warnings

The confirmation should explain which purchase order is being deleted and whether expected supply will be released. If receipt history exists, deletion should be blocked with a clear reason.
