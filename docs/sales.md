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
- `draft`, `confirmed`, `partially_shipped`, `shipped`, and `cancelled` statuses
- projection-backed committed supply from non-deleted confirmed orders with non-deleted lines
- oversell warnings on confirm-entry actions only
- sales shipments under confirmed and partially shipped orders
- draft shipment BOLs before loading
- final shipment BOLs after shipping
- outbound shipment cost capture and margin visibility
- FIFO stock deduction during shipping
- `sales_consumption` ledger events for per-lot audit history

Sales v1 does not include:

- pricing rules
- returns / unship
- landed cost
- Xero freight invoice lines
- AP matching or GL postings

## Status Rules

- `draft` orders are editable
- `confirmed` orders are read-only and can create draft shipments, cancel remaining quantities, or be soft-deleted
- `partially_shipped` orders are read-only and can create more draft shipments or cancel remaining quantities
- `shipped` orders are terminal, read-only, and can only be soft-deleted
- `cancelled` orders are terminal and can only be soft-deleted

Valid transitions:

- create `draft`
- create `confirmed`
- edit `draft`
- confirm `draft`
- create/cancel/edit draft shipment under `confirmed` or `partially_shipped`
- ship draft shipment from `confirmed` or `partially_shipped`
- ship final remaining quantity to reach `shipped`
- cancel remaining quantity from `confirmed` or `partially_shipped`
- cancel `confirmed`
- soft-delete `draft`
- soft-delete `confirmed`
- soft-delete `partially_shipped`
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
- edit shipped/cancelled shipments
- cancel shipped shipments
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
- products and customers used by active draft, confirmed, or partially shipped sales orders cannot be soft-deleted
- shipped orders rely on snapshots for history and do not block customer or product soft delete

## Oversell Warning

- overselling is allowed
- warning applies only when the action would move the order into `confirmed`
- use the main `POST` or `PUT` route
- server returns `409` with warning payload unless `confirmOversell === true`
- client shows a warning dialog and may retry with `confirmOversell: true`

## Shipments and BOLs

- a sales order is the commercial object; a sales shipment is the physical fulfillment object
- confirmed order reservation/demand covers the full ordered quantity
- draft shipments do not reserve additional inventory; they allocate planned slices of existing order demand
- `remaining_to_ship = ordered_qty - shipped_qty - cancelled_qty`
- `unplanned_remaining = remaining_to_ship - sum(draft shipment planned_qty)`
- backend validation enforces draft planned quantity plus shipped quantity cannot exceed ordered quantity minus cancelled quantity
- shipment numbers use order suffixes like `SO-2026-0123-S1`; numbers are never reused
- draft shipments are editable/cancellable and can produce a clearly labeled Draft BOL / Planned Shipment
- shipped shipments are immutable and produce final shipment BOLs
- shipment costs and customer freight recovery stay editable after shipping because they do not change stock movement history
- shipping a draft shipment consumes live lot-backed stock FIFO for shipment quantities only
- shipping hard-blocks on insufficient stock; there is no override path
- successful shipment shipping writes `sales_consumption` inventory events against `referenceType = sales_shipment`
- shipment shipping releases demand/reservation only for shipped quantities and flushes item/reservation projections in the same transaction
- successful non-final shipment shipping sets order `status = partially_shipped`
- successful final shipment shipping sets order `status = shipped` and `shippedAt = now()`
- cancelling remaining quantities cancels open draft shipments, releases remaining demand/reservation, increments line `cancelledQuantity`, and sets the order to `cancelled`
- cancelled orders with shipped shipments should be rendered as partially fulfilled / remaining cancelled in UI and reports

## Shipment Costs and Margin

- shipment costs track outbound cost only: freight, delivery labor, fuel, packaging, accessorials, or other
- cost rows are either `estimated` or `actual`
- if any actual cost exists for a shipment, margin uses actual shipment costs; otherwise it uses estimated costs
- customer freight recovery is a margin/reporting field only and is not an invoice line in this version
- editing shipment costs or freight recovery must not write inventory events, Xero invoice lines, AP records, GL entries, or BOL changes
- draft shipment margin uses estimated item COGS from current stock-unit cost, available product lot cost, or active BOM cost
- shipped shipment margin uses actual FIFO COGS from `sales_consumption` events with `referenceType = sales_shipment`
- formula: product revenue + customer freight recovery - product COGS - shipment costs = contribution margin

## Committed Supply Projection

Only this contributes to committed supply:

- non-deleted orders
- status = `confirmed` or `partially_shipped`
- non-deleted lines

`shipped` and `cancelled` orders do not contribute to committed supply. For partial shipments, committed supply is the remaining open demand, not the original ordered quantity.

The kernel model is:

- `reservation_increase` and `reservation_release` ledger events
- `inventory_reservations_summary` for open per-line reservations
- `inventory_item_balances.committedQty` for hot-path availability reads

Implementation rule:

- sales DAL code must call the kernel reservation operations for confirm, edit-confirmed, cancel remaining, shipment shipping, whole-order compatibility shipping, and delete paths
- sales must never mutate committed quantity directly or bypass the kernel projections
