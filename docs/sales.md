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
- account state and priority for landed-customer management
- customer projects/jobs as optional sales-order context
- multi-line sales orders
- customer and product snapshots on saved orders
- `open` and `done` statuses
- projection-backed committed supply from non-deleted confirmed orders with non-deleted lines
- sales shipments under confirmed and partially shipped orders
- automatically generated draft shipment BOLs before loading
- automatically generated final shipment BOLs after shipping
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

- `open` orders are editable operational work
- `done` orders are terminal fulfillment history
- delete is allowed only before shipped fulfillment, finalized invoice, or accounting-push history exists

Valid transitions:

- create `open`
- edit `open`
- create/delete/edit planned shipment under `open`
- ship planned shipment from `open`
- ship final remaining quantity to reach `done`
- soft-delete `open`

Invalid transitions:

- edit `done`
- ship `done`
- soft-delete `done`
- edit shipped shipments
- cancel shipped shipments

## Soft Delete Rules

- customers use soft delete
- sales orders use soft delete

- deleting an open order soft-deletes the order row, deletes planned shipments,
  deletes linked open manufacturing orders created specifically for that sales
  order, and releases active allocations/reservations
- editing a draft order hard-deletes all existing lines, then inserts a fresh set
- shipped fulfillment, finalized invoices, accounting pushes, completed
  manufacturing output, and finalized inventory consumption block deletion
- active list and selector reads exclude soft-deleted rows
- direct route access may still render a deleted order in read-only detail mode

## Snapshots

- orders store `customerName`
- orders may link to a customer project/job with `customerProjectId`
- lines store `itemName`, `itemSku`, and `unitName`
- list/detail pages render snapshots so renamed or deleted records do not break history
- customers are the managed account; projects/jobs are the work context; sales orders remain the commercial object
- project links are optional, and orders without a project must keep working
- products and customers used by active draft, confirmed, or partially shipped sales orders cannot be soft-deleted
- shipped orders rely on snapshots for history and do not block customer or product soft delete

## Oversell Behavior

- overselling is allowed
- creating, editing, or confirming a sales order does not show an oversell warning
- `confirmOversell` may still appear in older clients, but the server ignores it
- shipping is the stock-consuming step and may warn/require confirmation for negative stock

## Sales Allocation

The Sales Allocation tab is the authoritative manual allocation surface.

- allocation demand includes only non-deleted sales order lines on `confirmed` or `partially_shipped` orders
- `draft`, `shipped`, and `cancelled` orders are excluded from allocation demand
- draft sales orders must not hold allocation rows or trigger allocation takeover behavior during confirmation
- sales order line demand is the unplanned residual bucket: `remaining_to_ship - planned shipment qty`
- sales shipment line demand is the planned shipment bucket
- creating or increasing planned shipments automatically pulls active allocations from matching unplanned demand
- decreasing or deleting planned shipments automatically moves excess allocations back to matching unplanned demand
- available inventory-lot sources come from current available lot balances
- manufacturing-order sources are allocatable only after the MO is `released`
- draft MOs are planning work only; they are not allocatable supply
- allocation writes go through `/api/allocation/save` with `demandType = "sales_order_line"` for unplanned demand or `demandType = "sales_shipment_line"` for planned shipment demand
- allocation reads go through `/api/allocation/workspace` or the Sales Allocation tab read model
- do not reintroduce the old allocation sheet, per-line allocation route, item allocation route, or sales-order allocation bulk route

## Shipments and BOLs

- a sales order is the commercial object; a sales shipment is the physical fulfillment object
- confirmed order reservation/demand covers the full ordered quantity
- draft shipments do not reserve additional inventory; they allocate planned slices of existing order demand
- `remaining_to_ship = ordered_qty - shipped_qty - cancelled_qty`
- `unplanned_remaining = remaining_to_ship - sum(draft shipment planned_qty)`
- backend validation enforces draft planned quantity plus shipped quantity cannot exceed ordered quantity minus cancelled quantity
- shipment numbers use order suffixes like `SO-2026-0123-S1`; numbers are never reused
- planned shipments are editable/deletable and automatically expose a shipment BOL before loading
- shipped shipments are immutable and automatically expose final shipment BOLs
- shipment costs and customer freight recovery stay editable after shipping because they do not change stock movement history
- shipping a draft shipment consumes live lot-backed stock FIFO for shipment quantities only
- shipping may warn before recording negative stock; retrying with `confirmNegativeStock` continues
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
