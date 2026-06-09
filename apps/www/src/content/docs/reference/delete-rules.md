---
title: Delete Rules
description: When Ashicore deletes mistakes, when it releases dependent state, and when it preserves operational history.
section: Reference
order: 340
---

Deletion is for mistakes and reversible operational work. It is not a way to erase receipts, shipments, production output, stocktake adjustments, accounting pushes, or other history that already changed the business record.

## Global rule

Delete only when dependent effects can be removed or reversed safely in the same transaction.

If a record has produced durable inventory, fulfillment, accounting, or audit history, block deletion and preserve the record for traceability.

## Purchasing

Draft purchase orders can be deleted.

Ordered purchase orders can be deleted before receipt. Deleting an ordered purchase order must release expected supply in the same transaction.

Partially received and received purchase orders should block deletion because purchase receipt inventory history and lot cost history must remain intact.

Received purchase order lines cannot be removed. Ordered quantity cannot be reduced below already received quantity.

## Sales

Open, unshipped sales orders can be deleted when there is no finalized fulfillment or accounting history.

Deleting an eligible sales order should:

- soft-delete the order
- remove planned shipments
- release active demand coverage
- release open demand
- remove linked open manufacturing orders created specifically for that sales order when safe

Deletion should be blocked by shipped fulfillment, finalized invoices, accounting push history, completed manufacturing output, or finalized inventory consumption.

## Manufacturing

Open manufacturing orders can be deleted only while inventory effects can be cleaned up.

Deleting an eligible manufacturing order should:

- release expected finished-good supply
- release ingredient demand
- clear active coverage
- reverse picked ingredient state back to the original lots when applicable

Completed output blocks deletion. Produced lots are inventory history.

## Stocktakes

Draft stocktakes can be deleted because they have not changed inventory.

Completed stocktakes cannot be deleted. Completion writes gain, loss, or verification events that explain why inventory changed or was physically verified.

## Master data

Customers, suppliers, materials, products, and variants are usually soft-deleted instead of erased.

Active operational references block deletion. Examples:

- material on active draft, ordered, or partial purchase orders
- product on active sales orders
- finished product or ingredient on active manufacturing orders
- item inside a draft stocktake

Completed history should rely on snapshots so old documents stay readable after master data is retired.

## Confirmation copy

A destructive confirmation should name the object, state what dependent records will be removed or released, and explain why the action is blocked when history exists.

Good confirmation copy is specific:

```text
Delete PO-1042?
This will remove the ordered purchase order and release 325 gallons of expected binder supply.
No received lots exist yet.
```

Blocked copy should be equally specific:

```text
PO-1042 cannot be deleted because 100 gallons have already been received.
Received lots are inventory history. Close or archive the order instead.
```

## Related docs

Read [Why Delete Instead of Cancel](/docs/design-decisions/why-delete-instead-of-cancel), [Inventory](/docs/concepts/inventory), and [Manufacturing Orders](/docs/concepts/manufacturing-orders).
