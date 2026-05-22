---
title: Manufacturing Orders
description: The production document that turns recipe demand into finished stock.
section: Concepts
order: 140
---

## User problem

The team needs to plan and record production without losing track of material requirements, shortages, actual output, and finished-goods stock.

## Mental model

A manufacturing order is a controlled production promise. It starts as a plan, becomes real when released, and changes inventory when materials are consumed and finished output is completed.

## User workflow

Create the order from a product recipe, review material requirements, release it when work is ready, pick or consume materials through the normal path, and complete it with the actual finished quantity.

## System behavior

The order stores the production context needed to execute work even if item names or recipes change later. Released orders can affect expected supply. Completion creates finished stock and ledger history.

## Edge cases

Actual output may differ from planned output. Materials may be short. Recipes may change while an order is open. A partially executed order should preserve inventory history rather than being treated like a clean draft.
