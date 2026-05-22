---
title: First Manufacturing Workflow
description: Make one product from a recipe and confirm that material demand and finished output behave correctly.
section: Start here
order: 30
---

Use this path to validate batch production before rolling out a larger manufacturing process.

## User problem

The team needs to know whether Ashicore can answer a practical question: can we make this product, what materials will it consume, and what finished stock will be created?

## Workflow

1. Create the material items and enter opening stock.
2. Create the product item.
3. Add the product recipe with material quantities.
4. Create a manufacturing order for the product.
5. Review material availability.
6. Release the order when the work is real.
7. Complete the order with the actual finished quantity.
8. Review the product lot and inventory ledger.

## System behavior

The recipe drives planned material demand. Releasing the manufacturing order can create expected finished supply. Completing the order records finished stock and inventory history.

## Checks

The material demand should match the recipe. Finished output should appear only after completion. If materials are short, the order should make the shortage visible instead of pretending production is ready.
