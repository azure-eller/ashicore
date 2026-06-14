---
title: Invariants
description: Non-negotiable system rules for inventory, purchasing, manufacturing, sales, deletes, and planning.
section: Developer
order: 720
---

These are the rules that keep Ashicore from drifting into spreadsheet behavior.

## Inventory

Inventory is ledger-driven. On-hand, available, demand, expected, and lot balances are projections of controlled events.

Never directly update quantity to make a page look right. Stock, lots, costs, demand, expected supply, dispositions, and physical execution must go through the inventory/domain paths.

Positive stock writes must have a cost basis. Negative stock writes must preserve consumption history.

## Purchasing

Ordered and partially received purchase orders contribute expected material supply.

Receiving creates lots, writes purchase receipt events, and releases the received expected supply.

Already received quantity and receipt-time lot cost are historical. Later landed-cost edits may create controlled revaluation events for eligible on-hand tracked lots; they should not silently rewrite receipt history.

## Manufacturing

Manufacturing orders are `open` while they are active and `done` when terminal. Releasing an open order creates expected finished-good supply and ingredient demand.

Picking consumes ingredient stock. Completion creates finished-product stock. Completion must not consume the same picked ingredients again.

Manufacturing order snapshots are historical execution truth. Later recipe edits must not rewrite open or done order snapshots unless the user explicitly edits the order before execution starts.

## Sales

Non-deleted open sales orders create active sales demand. Done and deleted orders do not.

Sales allocation reserves supply but does not change on-hand stock.

Shipping is the sales stock event. Shipped shipments preserve physical history and should not be edited as if they were draft plans.

## Deletes

Delete mistakes when dependent effects can be cleaned up atomically.

Block deletion when inventory receipt history, shipped fulfillment, produced output, stocktake completion, finalized invoice history, or accounting push history exists.

Soft-deleted master data must remain readable through snapshots on historical documents.

## Planning

Planning is deterministic and read-first. It should consume structured planning snapshots, not scrape raw module tables from UI code.

Draft recommendations create drafts only. The server must recompute the snapshot before acting and reject stale or changed recommendations.

## API and DAL boundaries

Pages and components call API routes through query/mutation hooks.

API routes call domain/DAL functions.

DAL functions use authenticated org context and database transactions.

Pages, components, and API routes must not import the database client directly.

## Related docs

Read [Architecture](/docs/developer/architecture), [Inventory](/docs/concepts/inventory), [Delete Rules](/docs/reference/delete-rules), and [API Reference](/docs/reference/api-reference).
