---
title: Inventory
description: The shared stock model behind purchasing, manufacturing, sales, stocktakes, and planning.
section: Concepts
order: 110
---

## User problem

Operators need one reliable answer to "what do we have?" The answer has to account for physical stock, promised stock, inbound supply, blocked lots, and future production.

## Mental model

Inventory is not a single editable number. It is the result of documented movements: opening stock, purchase receipts, manufacturing consumption, manufacturing output, shipments, stocktake adjustments, and corrections.

## User workflow

Use inventory pages to inspect items, lots, balances, and ledger history. Use purchasing to bring material in, manufacturing to consume and produce stock, sales to commit and ship stock, and stocktakes to reconcile physical counts.

## System behavior

Ashicore records inventory through canonical inventory paths. That keeps lots, costs, commitments, expected supply, and projections synchronized. Quantity changes should have a source document and an audit trail.

## Invariants

On-hand stock should represent physical stock. Available stock should not include stock already committed or blocked. Expected stock should come from active inbound or production documents, not from draft notes.

## Related docs

Read [Inventory Status Reference](/docs/reference/inventory-statuses), [Allocation Rules](/docs/reference/allocation-rules), and [Receive Inventory](/docs/how-to/receive-inventory).
