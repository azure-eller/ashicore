---
title: Prioritize Demand
description: Decide which customer or production demand should receive scarce supply.
section: How-to
order: 220
---

## User problem

The team needs to decide which order or job gets scarce stock.

## Steps

1. Open the demand view.
2. Review physical availability, existing demand coverage, blocked stock, and expected supply.
3. Move the highest-priority demand earlier in the queue.
4. Review updated coverage and remaining shortages.
5. Reprioritize demand if the plan changes.

## System behavior

Priority changes do not reduce on-hand stock. They recompute planning coverage. Physical quantity changes later through shipment or manufacturing consumption.

## Edge cases

If coverage is lower than expected, check blocked lots, earlier demand, and open expected supply. If a document is deleted or reduced, queue coverage recomputes from the remaining demand.
