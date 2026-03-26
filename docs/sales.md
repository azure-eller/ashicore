---
read_when:
  - Working on the sales module
  - Editing sales orders or customers
  - Implementing oversell warnings or committed quantity updates
  - Changing sales soft-delete behavior
---

# Sales Module

## Scope

Sales v1 includes:

- customer CRUD
- multi-line sales orders
- customer and product snapshots on saved orders
- `draft`, `confirmed`, and `cancelled` statuses only
- `items.committedQty` updates from non-deleted confirmed orders with non-deleted lines
- oversell warnings on confirm-entry actions only

Sales v1 does not include:

- fulfillment
- stock deduction / FIFO
- sales stock movements
- accounting sync
- manufacturing links
- pricing rules

## Status Rules

- `draft` orders are editable
- `confirmed` orders are read-only and can only be cancelled or soft-deleted
- `cancelled` orders are terminal and can only be soft-deleted

Valid transitions:

- create `draft`
- create `confirmed`
- edit `draft`
- confirm `draft`
- cancel `confirmed`
- soft-delete `draft`
- soft-delete `confirmed`
- soft-delete `cancelled`

Invalid transitions:

- edit `confirmed`
- edit `cancelled`
- cancel `draft`
- transition out of `cancelled`

## Soft Delete Rules

- customers use soft delete
- sales orders use soft delete

Historical rules:

- deleting an order soft-deletes the order row
- editing a draft order hard-deletes all existing lines, then inserts a fresh set
- active list and selector reads exclude soft-deleted rows
- direct route access may still render a deleted order in read-only detail mode

## Snapshots

- orders store `customerName`
- lines store `itemName`, `itemSku`, and `unitName`
- list/detail pages render snapshots so renamed or deleted records do not break history
- products used by active draft or confirmed sales orders cannot be soft-deleted from inventory

## Oversell Warning

- overselling is allowed
- warning applies only when the action would move the order into `confirmed`
- use the main `POST` or `PUT` route
- server returns `409` with warning payload unless `confirmOversell === true`
- client shows a warning dialog and may retry with `confirmOversell: true`

## Committed Quantity

Only this contributes to `items.committedQty`:

- non-deleted orders
- status = `confirmed`
- non-deleted lines

Implementation rule:

- always recompute affected product ids from the database after allowed state-changing writes
- never increment/decrement committed qty directly
