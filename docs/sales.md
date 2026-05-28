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
- customer-category and selected-item pricing schedules with quantity breaks
- customer projects/jobs as optional sales-order context
- multi-line sales orders
- customer and product snapshots on saved orders
- `open` and `done` statuses
- projection-backed committed supply from non-deleted open orders with non-deleted lines
- order-level shipping with optional partial stock consumption
- order-level shipping fee capture and margin visibility
- FIFO stock deduction during shipping
- `sales_consumption` ledger events for per-lot audit history

Manufactured product margins use inventory cost. Estimated sales margin uses the
estimated product unit cost, including standard operation costs when the product
BOM revision defines them. Actual shipped margin uses consumed lot cost only;
manufactured lots already include absorbed standard operation cost.

Sales v1 does not include:

- returns / unship
- landed cost
- Xero freight invoice lines
- AP matching or GL postings

## Detail page UI

The order detail page at `/sales/orders/[id]` uses the unified Calm Matrix
single-page card (`app/(dashboard)/sales/orders/[id]/order-card.tsx`). The
previous 4-tab read-only view + separate `/edit` modal are being retired; the
new card folds them into one inline-editable surface. The legacy 4-tab view
remains accessible at `/sales/orders/[id]?view=legacy` until inline-edit and
the new plan-shipment dialog finish landing.

### Derived delivery display status

The header/list delivery pill is **derived** from actual shipped sales-order
line quantity plus the order's persisted `status`. See
`lib/sales/order-display-status.ts#deriveOrderDisplayStatus`. The DB still
stores only `open` / `done`; the delivery pill only shows NOT SHIPPED /
PARTIALLY SHIPPED / SHIPPED. Allocation readiness belongs in the Allocation
column and must not influence delivery status.

### Relocated entry points

The redesign moves a few entry points out of the deprecated tabs:

- **Manufacturing**: Create MOs lives in the header ⋯ menu (only enabled when
  `hasManufacturableLines === true`). The MO list panel is dropped from the
  order page; linked MOs are visible from each manufacturable item.
- **Activity**: dropped from the order page entirely (future: global audit
  panel; see `docs/design-system/sales-order-detail/README.md` §14).
- **Accounting / Xero push**: order-level push lives in the header ⋯ menu;
  historical per-shipment push paths are deprecated.

## Status Rules

- `open` orders are editable operational work
- `done` orders are terminal fulfillment history
- delete is allowed only before shipped fulfillment, finalized invoice, or accounting-push history exists

Valid transitions:

- create `open`
- edit `open`
- ship an open order
- ship final remaining quantity to reach `done`
- soft-delete `open`

Invalid transitions:

- edit `done`
- ship `done`
- soft-delete `done`

## Soft Delete Rules

- customers use soft delete
- sales orders use soft delete

- deleting an open order soft-deletes the order row, deletes linked open
  manufacturing orders created specifically for that sales order, and releases
  active allocations/reservations
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
- products and customers used by active open sales orders cannot be soft-deleted
- shipped orders rely on snapshots for history and do not block customer or product soft delete

## Oversell Behavior

- overselling is allowed
- creating, editing, or confirming a sales order does not show an oversell warning
- `confirmOversell` may still appear in older clients, but the server ignores it
- shipping is the stock-consuming step and may warn/require confirmation for negative stock

## Sales Allocation

The Sales Allocation tab is the authoritative manual allocation surface.

- allocation demand includes only non-deleted sales order lines on `open` orders
- `done` orders are excluded from allocation demand
- draft sales orders must not hold allocation rows or trigger allocation takeover behavior during confirmation
- sales order line demand is the allocation bucket: `remaining_to_ship`
- legacy planned shipment rows do not own allocation demand
- available inventory-lot sources come from current available lot balances for
  lot-tracked products; lot-untracked products expose item-level FIFO supply
- manufacturing-order sources are allocatable only after the MO is `released`
- draft MOs are planning work only; they are not allocatable supply
- allocation writes go through `/api/allocation/save` with `demandType = "sales_order_line"` for sales demand
- allocation reads go through `/api/allocation/workspace` or the Sales Allocation tab read model
- do not reintroduce the old allocation sheet, per-line allocation route, item allocation route, or sales-order allocation bulk route

## Shipping

- a sales order is both the commercial object and the fulfillment target
- separate planned ship dates require separate sales orders
- users set `shipDate` on the sales order; no shipment rows are created for new orders
- active shipment mutation routes return `410 Gone`
- `remaining_to_ship = ordered_qty - shipped_qty - cancelled_qty`
- shipping consumes live lot-backed stock FIFO for the order quantities
- shipping may warn before recording negative stock; retrying with
  `confirmNegativeStock` continues
- successful order shipping writes `sales_consumption` inventory events against
  `referenceType = sales_order`
- successful final shipping sets order `status = done` and `shippedAt = now()`
- legacy shipment tables may still exist for historical reads/BOLs, but they are
  not an active planning or allocation surface

Lot-untracked products consume the hidden `INTERNAL-UNTRACKED` lot. Sales UI and
allocation contracts should not ask operators to choose or inspect that lot.

## Shipping Fees and Margin

- order-level shipping fee tracks customer freight recovery
- shipping fee and shipping fee tax are order total fields
- editing shipping fee fields must not write inventory events, Xero invoice
  lines, AP records, GL entries, or BOL changes
- estimated margin uses current stock-unit cost, available product lot cost, or
  active BOM cost
- shipped margin uses actual FIFO COGS from `sales_consumption` events
- formula: product revenue + shipping fee - product COGS - shipping costs =
  contribution margin

## Committed Supply Projection

Only this contributes to committed supply:

- non-deleted orders
- status = `open`
- non-deleted lines

`done` orders do not contribute to committed supply. For partial shipping,
committed supply is the remaining open demand, not the original ordered
quantity.

The kernel model is:

- `reservation_increase` and `reservation_release` ledger events
- `inventory_reservations_summary` for open per-line reservations
- `inventory_item_balances.committedQty` for hot-path availability reads

Implementation rule:

- sales DAL code must call the kernel reservation operations for create, edit,
  delete, and order shipping paths
- sales must never mutate committed quantity directly or bypass the kernel projections
