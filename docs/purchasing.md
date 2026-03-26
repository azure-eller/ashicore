---
read_when:
  - Working on the purchasing module
  - Editing suppliers, purchase orders, or receiving
  - Wiring purchase-order UI, API routes, or DAL queries
  - Debugging expected quantities, delete guards, or received lots
---

# Purchasing Module

## Scope

Purchasing v1 includes:

- supplier CRUD
- draft purchase orders for materials only
- supplier and material snapshots on saved orders
- `draft`, `ordered`, `partial`, `received`, and `cancelled` statuses
- partial receiving into lot-backed inventory
- `items.expectedQty` updates from active ordered and partially received purchase orders

Purchasing v1 does not include:

- invoices or payments
- taxes, discounts, or landed cost
- alternate vendor units or pack conversions
- receiving locations
- supplier lot numbers or expiry dates

## Status Rules

- `draft` orders are editable
- `ordered` orders are frozen and may be received or cancelled
- `partial` orders are frozen and may only continue receiving
- `received` orders are terminal
- `cancelled` orders are terminal

Valid transitions:

- create `draft`
- edit `draft`
- submit `draft` -> `ordered`
- receive `ordered` -> `partial`
- receive `ordered` -> `received`
- receive `partial` -> `received`
- cancel `ordered`
- soft-delete `draft`
- soft-delete `received`
- soft-delete `cancelled`

Invalid transitions:

- edit `ordered`
- edit `partial`
- cancel `partial`
- delete `ordered`
- delete `partial`

## Snapshots

- orders store `supplierName`
- lines store `itemName`, `itemSku`, and `unitName`
- list/detail pages render snapshots so renamed or deleted suppliers/materials do not break history
- materials used by active draft, ordered, or partial purchase orders cannot be soft-deleted from inventory
- suppliers used by active draft, ordered, or partial purchase orders cannot be soft-deleted

## Receiving

Receiving is lot-backed and positive-only:

- each non-zero received line creates one new internal lot
- lot quantity = received quantity
- lot cost per unit = purchase-order line unit cost
- one `purchase_received` stock movement is written per received lot
- receiving recomputes `items.expectedQty` from the remaining unreceived quantity

Blank receive inputs are ignored. Received quantity must be greater than zero and no greater than the current line remainder.

## Expected Quantity

`items.expectedQty` is the shared inbound-supply cache:

- released manufacturing orders contribute finished-product planned quantity
- ordered and partially received purchase orders contribute material remaining quantity

Implementation rule:

- always recompute affected item ids from the database after submit, receive, cancel, release, complete, or manufacturing cancellation
- never increment/decrement expected quantity directly
