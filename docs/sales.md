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
- unsaved new sales-order cards that keep local edits and wait for a customer before the first create
- customer and item snapshots on saved orders
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

- **Manufacturing**: Create MOs lives in the header ⋯ menu (only shown when
  `hasManufacturableLines === true`) and, on open orders, in each manufacturable
  line's production cell (Make to order / Make to stock). Both use the Create
  Manufacturing Orders dialog. The header entry point best-effort flushes valid
  dirty card edits before the dialog refetches the persisted manufacturing
  preview and still opens on blocked drafts. A line production action requires
  the draft to save first, then scopes the dialog and open-MO list to the
  selected line so its quantity and duplicate-MO guards are current. The MO list
  panel is dropped from the order page; linked MOs are visible from each
  manufacturable item.
- **Activity**: dropped from the order page entirely. Future audit history
  should live in a global audit panel, not in sales-order tabs.
- **Accounting / Xero push**: order-level push lives in the header ⋯ menu;
  historical per-shipment push paths are deprecated.

## Status Rules

- A new sales-order card is local-only until a customer is selected. Header and
  line edits remain on the card, but the first autosave is deferred so the
  server only creates valid customer-backed orders. The save indicator says
  that the customer is required from the moment the blank card opens.
- `open` orders are editable operational work
- `done` orders are terminal fulfillment history
- delete is allowed only before shipped fulfillment, finalized invoice, or accounting-push history exists

Valid transitions:

- create `open`
- edit `open`
- ship an open order after pending valid edits save
- ship final remaining quantity to reach `done`
- cancel remaining unshipped quantity on a partially shipped order to reach `done`
- soft-delete `open`

Invalid transitions:

- edit `done`
- ship `done`
- cancel remaining items before any quantity has shipped
- cancel remaining items after an accounting invoice has been pushed
- cancel remaining items while linked open manufacturing orders still exist
- soft-delete `done`

## Soft Delete Rules

- customers use soft delete
- sales orders use soft delete

- deleting an open order soft-deletes the order row, deletes linked open
  manufacturing orders created specifically for that sales order, and releases
  open demand
- editing an eligible open order hard-deletes all existing lines, then inserts a fresh set
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
- items and customers used by active open sales orders cannot be soft-deleted
- shipped orders rely on snapshots for history and do not block customer or item soft delete

## Pricing

- sales order lines may use any non-deleted product or material whose `sellable` flag is true
- a pricing schedule has a product item scope: all sellable products, a product category, a variant value, or specific selected products
- a sales-order product line considers every schedule whose customer scope and item scope both match the product — these scopes can overlap (a product may match an `all`, a `category`, a `variant`, and a `selected` schedule at once)
- sellable material lines use their base selling price; pricing schedules do not apply to material lines
- when several schedules match, the most favorable (lowest resulting unit price) wins; there is no scope-specificity precedence, so a broad category or variant schedule can undercut a price set on a specific item
- schedule changes do not retroactively reprice existing sales-order lines
- manual price or discount edits update the line snapshot, not the source schedule

## Pricing Scenarios (beta)

`/sales/pricing-scenarios` is a costing workspace gated by the
`pricing_scenarios` beta plugin (see `docs/billing.md` → Beta plugins). A
scenario is a card-kernel document (autosave, versioned saves, standard
duplicate/soft-delete) holding a product selection plus **sparse overrides**:
per-leaf-item material price / inbound freight / handling, per-resource labor
rates, global overhead % and target profit %, and per-product current price /
outbound freight.

The worksheet labels every result in the selected product's stock unit. Material
price, inbound freight, and handling remain rates per material stock unit; the
worksheet multiplies their landed rate by recipe usage to show the derived
material cost per product unit. Labour similarly shows hours and derived cost
per product unit. Product and material unit names come from the live baseline,
so the sticky results rail can keep cost to recover, sell-at, its breakdown, and
current margin in one explicit unit context.

- The baseline is always **live ERP data**, resolved per request:
  `getProductUsageTermsByItemIdInTx` (`lib/inventory/estimated-cost.ts`)
  flattens each product's current recipe tree into per-unit leaf quantities
  and operation hours on the same graph the estimated-cost roll-ups use; leaf
  prices resolve exactly like estimated cost, labor rates come from
  manufacturing resources, current price from `items.defaultSellingPrice`.
- The pure isomorphic engine (`lib/pricing-scenarios/calculations.ts`)
  implements the sales-share model:
  `sellAt = (directCost + outboundFreight) / (1 − overhead − targetProfit)`,
  with results withheld (never zero/NaN) on recipe issues, missing prices, or
  combined rates ≥ 100%.
- **Revisions are the history model** (like BOM revisions): committing one
  resolves live baseline + overrides server-side and inserts an immutable
  numbered snapshot carrying inputs *and* results into
  `sales.pricing_scenario_revisions` (insert-only; app role has no
  UPDATE/DELETE). Later ERP changes move the working scenario, never a
  committed revision. A revision can be viewed in the card and restored as
  sparse overrides in the current draft; restoring does not alter the revision.
  Soft-deleting a scenario keeps its revisions. Material and labour snapshot
  rows include their derived `costPerUnit`; the reader defaults that field to
  `null` so revisions written before the worksheet added it remain readable.
- Scenario writes touch only the two scenario tables plus the idempotency
  ledger — never items, recipes, prices, inventory, orders, or accounting.

The scenario document accepts at most 200 products. Names are 1–120 characters,
revision notes are at most 500 characters, override values are non-negative,
and overhead plus target profit must remain below 100%.

### Pricing scenario API

All routes require Sales module access and the `pricing_scenarios` beta
entitlement. Create, duplicate, and revision-commit requests also require an
`Idempotency-Key` header.

| Route | Behaviour |
| --- | --- |
| `GET /api/pricing-scenarios` | Lists active scenarios with their latest revision number. |
| `POST /api/pricing-scenarios` | Creates a scenario from `{ id?, name, doc }` and returns its live detail. |
| `GET /api/pricing-scenarios/:id` | Returns the saved document, live baseline (including product/material unit names) and usage terms, and revision summaries. |
| `PATCH /api/pricing-scenarios/:id` | Replaces `name` and `doc`; `expectedVersion` enables optimistic-concurrency conflict responses. |
| `DELETE /api/pricing-scenarios/:id` | Soft-deletes the scenario. |
| `POST /api/pricing-scenarios/:id/duplicate` | Copies the name and document, but not revisions; accepts an optional `name`. |
| `POST /api/pricing-scenarios/:id/revisions` | Computes and stores the next immutable snapshot; accepts an optional `note`. |
| `GET /api/pricing-scenarios/:id/revisions/:revisionId` | Returns one immutable revision snapshot; material and labour rows expose nullable derived `costPerUnit`. |

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
- non-open sales orders must not create demand or hold stock
- sales order line demand is `remaining_to_ship`
- legacy planned shipment rows do not own allocation demand
- available inventory-lot sources come from current available lot balances for
  lot-tracked products and materials; lot-untracked items expose item-level FIFO supply
- manufacturing-order sources count as expected supply only after release
- draft MOs are planning work only; they are not expected supply
- demand coverage reads go through the Sales Allocation tab read model
- do not reintroduce the old allocation sheet, per-line allocation route, item allocation route, or sales-order allocation bulk route

## Shipping

- a sales order is both the commercial object and the fulfillment target
- separate planned ship dates require separate sales orders
- users set `shipDate` on the sales order; no shipment rows are created for new orders
- active shipment mutation routes return `410 Gone`
- `remaining_to_ship = ordered_qty - shipped_qty - cancelled_qty`
- BOLs are stateless PDF projections over selected sales order line quantities.
  Operators can render a BOL before shipping; the route must not mutate orders,
  shipments, inventory, accounting, or saved BOL records.
- BOL PDFs include the order, invoice number when present, shipping address,
  primary shipping/contact person, notes, selected load quantities, standard
  short-form BOL legal/payment language, and hand-fill
  carrier/trailer/seal/SCAC/PRO/package/weight/HM/NMFC/class/declared-value/COD/freight/signature
  fields
- open-order BOL fallback quantities are remaining-to-ship. Done-order fallback
  quantities are shipped quantities when present, otherwise ordered minus
  cancelled quantity for legacy done rows that did not record shipped quantities.
- shipping consumes live lot-backed stock FIFO for the order quantities
- shipping may warn before recording negative stock; retrying with
  `confirmNegativeStock` continues
- successful order shipping writes `sales_consumption` inventory events against
  `referenceType = sales_order`, with the parent sales order and line IDs
  preserved in event metadata
- successful final shipping sets order `status = done` and `shippedAt = now()`
- partially shipped orders may be short-closed by cancelling the remaining
  unshipped quantities. This writes `cancelledQuantity`, releases remaining
  demand through the inventory kernel, clears `priorityRank`, and leaves
  `shippedAt` unchanged. Partials currently have `shippedAt = null` until a true
  final ship records the terminal shipment timestamp.
- short-close is blocked when the order already has pushed accounting invoice
  history or linked open manufacturing orders
- accounting invoice pushes are blocked for orders with cancelled remaining
  quantities until shipped-only invoicing is designed
- legacy shipment tables may still exist for historical reads/BOLs, but they are
  not an active planning or allocation surface

Lot-untracked items consume the hidden `INTERNAL-UNTRACKED` lot. Sales UI and
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
