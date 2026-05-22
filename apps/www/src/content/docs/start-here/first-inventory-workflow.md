---
title: First Inventory Workflow
description: Create items, enter opening stock, review lots, and use the ledger to verify what changed.
section: Start here
order: 20
---

This workflow proves that Ashicore can represent what is physically on the shelf before you add purchasing, manufacturing, or sales pressure.

## User problem

The team needs a trusted starting point: what items exist, which units they use, how much stock is on hand, and what that stock is worth.

## Workflow

1. Create the materials and products you need for the first real flow.
2. Use stable names, SKUs, and stock units.
3. Enter opening stock with quantity, lot, disposition, and stock-unit cost.
4. Review item balances.
5. Open the lot view to confirm the physical stock layers.
6. Open the ledger to confirm the inventory history.

## System behavior

Opening stock is recorded as inventory history. It should create traceable stock rather than silently overwriting a quantity. Future receipts, consumption, stocktakes, and shipments build on this initial state.

## Checks

The item balance should match the physical count. The lot list should explain where the quantity lives. The ledger should explain why the quantity changed.

If any of those are not true, fix the item before building manufacturing or sales workflows on top of it.
