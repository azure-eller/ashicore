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
- customer contacts, unified activity stream (notes/calls/emails/meetings/tasks), and project tags on the customer card
- customer-category and selected-item pricing schedules with quantity breaks
- customer projects/jobs as optional sales-order context
- multi-line sales orders
- customer and product snapshots on saved orders
- `open` and `done` statuses
- projection-backed demand coverage from non-deleted open orders with non-deleted lines
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

## Customer CRM model

The customer surface mirrors HubSpot's engagement model without becoming a CRM:

- the **customer** is the account; its email/phone are the organization's main
  channel (used for documents and accounting sync), not a person's. There is
  **no notes field anywhere** — anything written down is an activity entry
  (the old customer/contact notes columns were migrated into the stream)
- **contacts** are people; person-level email/phone/roles live there, and
  `is_primary` marks the default person to reach
- **`customer_activities`** is the single engagement stream: `note`, `call`,
  `email`, `meeting`, and `task`. A task is the only forward-pointing type —
  task-only columns (`due_date`, `status` `open`/`done`, `completed_at` set
  exactly when done) are enforced by CHECK constraints. Soft delete throughout.
  Open tasks render as "Upcoming" above the timeline; completed tasks live in
  the timeline and can be reopened.
- **the stream is singular; scoping is an association.** A narrower context
  (project, order) gets an optional FK column on `customer_activities` — never
  its own parallel notes/tasks/activity table. `customer_project_id` exists
  today; record pages render the stream filtered to their scope.
- the customers list "Due" view is the task queue: customers whose soonest open
  task has `due_date <= today` (org timezone); tasks without a due date stay
  out of the queue
- no leads, deals, pipelines, or sales-status fields — quotes (future) take the
  deal role; field additions require a view that acts on them

## Detail page UI

The order detail page at `/sales/orders/[id]` uses the unified single-page card
pattern (`app/(dashboard)/sales/orders/[id]/order-card.tsx`). The
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
- **Activity**: dropped from the order page entirely. Future audit history
  should live in a global audit panel, not in sales-order tabs.
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
  open demand
- editing a draft order hard-deletes all existing lines, then inserts a fresh set
- shipped fulfillment, finalized invoices, accounting pushes, completed
  manufacturing output, and finalized inventory consumption block deletion
- active list and selector reads exclude soft-deleted rows
- direct route access may still render a deleted order in read-only detail mode

## Snapshots

- orders store `customerName`
- orders may link to a customer project/job with `customerProjectId`
- lines store `itemName`, `itemSku`, and `unitName`
- lines store point-in-time pricing snapshots: list unit price, discount percent,
  suggested unit price, and pricing source
- list/detail pages render snapshots so renamed or deleted records do not break history
- customers are the managed account; projects/jobs are the work context; sales orders remain the commercial object
- project links are optional, and orders without a project must keep working
- products and customers used by active open sales orders cannot be soft-deleted
- shipped orders rely on snapshots for history and do not block customer or product soft delete

## Pricing

- a pricing schedule has an item scope: all sellable items, an item category, a variant value, or specific selected items
- a sales-order line considers every schedule whose customer scope and item scope both match the product — these scopes can overlap (a product may match an `all`, a `category`, a `variant`, and a `selected` schedule at once)
- when several schedules match, the most favorable (lowest resulting unit price) wins; there is no scope-specificity precedence, so a broad category or variant schedule can undercut a price set on a specific item
- schedule changes do not retroactively reprice existing sales-order lines
- manual price or discount edits update the line snapshot, not the source schedule

## Oversell Behavior

- overselling is allowed
- creating, editing, or confirming a sales order does not show an oversell warning
- `confirmOversell` may still appear in older clients, but the server ignores it
- shipping is the stock-consuming step and may warn/require confirmation for negative stock

## Sales Allocation

The Sales Allocation tab is a read-only demand coverage view. Demand priority
controls which open orders claim stock first; exact lots are chosen when shipping.

- allocation demand includes only non-deleted sales order lines on `open` orders
- `done` orders are excluded from allocation demand
- draft sales orders must not create demand or hold stock
- sales order line demand is `remaining_to_ship`
- legacy planned shipment rows do not own allocation demand
- available inventory-lot sources come from current available lot balances for
  lot-tracked products; lot-untracked products expose item-level FIFO supply
- manufacturing-order sources count as expected supply only after release
- draft MOs are planning work only; they are not expected supply
- demand coverage reads go through the Sales Allocation tab read model
- do not reintroduce the old allocation sheet, per-line allocation route, item allocation route, or sales-order allocation bulk route

## Shipping

- a sales order is both the commercial object and the fulfillment target
- separate planned ship dates require separate sales orders
- users set `shipDate` on the sales order; no shipment rows are created for new orders
- each successful order-level ship action creates a shipped shipment history row
  for the quantities shipped in that action
- active shipment mutation routes return `410 Gone`
- `remaining_to_ship = ordered_qty - shipped_qty - cancelled_qty`
- shipping consumes live lot-backed stock FIFO for the order quantities
- shipping may warn before recording negative stock; retrying with
  `confirmNegativeStock` continues
- successful order shipping writes `sales_consumption` inventory events against
  `referenceType = sales_shipment`, with the parent sales order and line IDs
  preserved in event metadata
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

Only this contributes to sales demand:

- non-deleted orders
- status = `open`
- non-deleted lines

`done` orders do not contribute to sales demand. For partial shipping, demand is
the remaining open quantity, not the original ordered quantity.

The kernel model is:

- `demand_increase` and `demand_release` ledger events for open business demand
- live demand queue coverage for planning availability and queue conflicts
- physical lot consumption events for shipping execution

Implementation rule:

- sales DAL code must record/release demand for create, edit, delete, and order
  shipping paths
- sales shipping validates demand-specific queue coverage in the transaction,
  then consumes physical stock through linked-output/FIFO execution rules
- sales must never persist soft planning claims or bypass the inventory kernel
