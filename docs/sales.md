---
read_when:
  - Working on the sales module
  - Editing sales orders or customers
  - Implementing shipping or sales stock deduction
  - Changing sales soft-delete behavior
---

# Sales Module

## Scope

Sales v1 includes:

- customer CRUD
- multi-line sales orders
- customer and product snapshots on saved orders
- `draft`, `confirmed`, `shipped`, and `cancelled` statuses
- `items.committedQty` updates from non-deleted confirmed orders with non-deleted lines
- oversell warnings on confirm-entry actions only
- whole-order shipping for confirmed orders
- FIFO stock deduction during shipping
- `sales_shipped` stock movements for audit history

Sales v1 does not include:

- manufacturing links
- pricing rules
- partial shipments
- per-line shipped quantities
- returns / unship

## Status Rules

- `draft` orders are editable
- `confirmed` orders are read-only and can be shipped, cancelled, or soft-deleted
- `shipped` orders are terminal, read-only, and can only be soft-deleted
- `cancelled` orders are terminal and can only be soft-deleted

Valid transitions:

- create `draft`
- create `confirmed`
- edit `draft`
- confirm `draft`
- ship `confirmed`
- cancel `confirmed`
- soft-delete `draft`
- soft-delete `confirmed`
- soft-delete `shipped`
- soft-delete `cancelled`

Invalid transitions:

- edit `confirmed`
- edit `shipped`
- edit `cancelled`
- cancel `draft`
- cancel `shipped`
- ship `draft`
- ship `cancelled`
- transition out of `cancelled`

## Soft Delete Rules

- customers use soft delete
- sales orders use soft delete

Historical rules:

- deleting an order soft-deletes the order row
- editing a draft order hard-deletes all existing lines, then inserts a fresh set
- deleting a shipped order is history-only and never restores stock
- active list and selector reads exclude soft-deleted rows
- direct route access may still render a deleted order in read-only detail mode

## Snapshots

- orders store `customerName`
- lines store `itemName`, `itemSku`, and `unitName`
- list/detail pages render snapshots so renamed or deleted records do not break history
- products and customers used by active draft or confirmed sales orders cannot be soft-deleted
- shipped orders rely on snapshots for history and do not block customer or product soft delete

## Oversell Warning

- overselling is allowed
- warning applies only when the action would move the order into `confirmed`
- use the main `POST` or `PUT` route
- server returns `409` with warning payload unless `confirmOversell === true`
- client shows a warning dialog and may retry with `confirmOversell: true`

## Shipping

- shipping is whole-order only in v1
- only `confirmed` orders may be shipped
- shipping consumes live lot-backed stock FIFO at the moment of shipping
- shipping hard-blocks on insufficient stock; there is no override path
- successful shipping writes `inventory.stock_movements` with:
  - `movementType = sales_shipped`
  - `referenceType = sales_order`
  - `referenceId = <sales order id>`
- successful shipping sets:
  - `status = shipped`
  - `shippedAt = now()`

## Committed Quantity

Only this contributes to `items.committedQty`:

- non-deleted orders
- status = `confirmed`
- non-deleted lines

`shipped` orders do not contribute to committed quantity.

Implementation rule:

- always recompute affected product ids from the database after allowed state-changing writes
- never increment/decrement committed qty directly
