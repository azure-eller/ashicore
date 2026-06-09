---
title: First Manufacturing Workflow
description: Build one product recipe, release production, pick ingredients, complete output, and verify cost.
section: Start here
order: 30
---

Use this workflow to prove that Ashicore can turn purchased material into finished stock with traceable cost.

## Prerequisites

Before starting, you need:

- a product item
- active material items
- available ingredient stock with usable lot cost
- a product recipe or BOM
- a realistic output quantity

Do not start by entering every recipe in the company. Prove one recipe end to end.

## Create the recipe

Choose the recipe basis.

Use unit basis when ingredient quantities scale directly per finished unit. Example: one bag uses 1 label and 40 lb of blend.

Use batch basis when the shop runs a batch and expects a batch yield. Example: one soil batch yields 9 yards and uses fixed bucket-loader quantities of multiple inputs.

Add packaging as ordinary ingredient lines. In v1, Ashicore does not model separate every-N packaging rules.

## Create and release the order

Create a manufacturing order from the product recipe. Review the ingredient snapshot before release.

Release the order when the work is real enough to affect planning. Release creates expected finished-good supply and ingredient demand. It does not consume material.

Draft orders remain planning work. Released orders become operational demand and expected supply.

## Pick ingredients

Picking is where ingredient stock is consumed.

Use selected lots when the operator knows exactly what was used. Otherwise Ashicore can consume by FIFO from eligible available lots.

After picking, check that ingredient lot quantities decreased and manufacturing consumption history exists.

## Complete output

Complete the order with the actual output quantity and disposition.

Completion creates finished-product stock. The produced lot cost comes from picked ingredient cost plus absorbed standard operation cost if configured.

Actual output can differ from planned output. Record the truth. Do not edit the original recipe snapshot to hide variance.

## Verify

After completion:

- the finished product has a new lot
- ingredient lots were consumed only once
- expected finished-good supply was released
- the manufacturing order shows actual output and cost
- sales margin can later use the produced lot cost

## Related docs

Read [Manufacturing Orders](/docs/concepts/manufacturing-orders), [Create a Batch Recipe](/docs/how-to/create-batch-recipe), and [Complete a Manufacturing Order](/docs/how-to/complete-manufacturing-order).
