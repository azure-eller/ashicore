---
title: Allocations
description: How Ashicore reserves stock for sales and manufacturing demand without double-promising inventory.
section: Concepts
order: 120
---

## User problem

The team needs to promise stock deliberately. Without allocations, the same available quantity can be mentally assigned to multiple customer orders or production jobs.

## Mental model

Allocation answers "who is this stock for?" It does not create stock and it does not ship stock. It reserves usable stock against a demand source.

## User workflow

Review open demand, choose the demand that should receive stock, allocate from available stock, and re-check shortages. If demand changes, release or move the allocation instead of leaving stock tied to the wrong document.

## System behavior

Allocations reduce availability while preserving on-hand quantity. Shipments and manufacturing consumption should consume through the inventory model so reservations, lots, and ledger history remain consistent.

## Invariants

Allocation must not exceed available stock. Deleting or changing a demand document must release dependent reservations. Shipment-specific allocation should win over generic order allocation when the workflow distinguishes them.

## Edge cases

Partial shipments, split shipments, manufacturing demand, deleted draft documents, blocked lots, and changed quantities all need explicit release or reallocation behavior.
