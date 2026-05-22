---
title: Inventory Invariants
description: Internal rules that must remain true across inventory, sales, purchasing, manufacturing, and stocktakes.
section: Developer
order: 620
---

## Guarantee

Inventory history, balances, lots, commitments, and expected supply must agree after each successful mutation.

## Invariants

On-hand stock changes only through inventory movements. Available stock must account for commitments and unavailable stock. Expected supply must be released when the real receipt or completion occurs. Deletes must release dependent planning effects. Allocation must not exceed available stock.

## Transaction behavior

Business mutations that affect stock, commitments, expected supply, or document state should update their dependent projections in the same transaction.

## Failure behavior

If a mutation cannot preserve these invariants, it should fail before committing partial state.
