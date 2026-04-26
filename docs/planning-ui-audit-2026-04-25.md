---
read_when:
  - Auditing the current Planning UI
  - Handing off the MRP-lite planning workspace to another developer
  - Changing planning workflow cards, filters, tables, detail drawer, or draft actions
---

# Planning UI Audit - 2026-04-25

This is an audit of the current Planning UI in the `planning-mrp-lite` worktree.
It reflects the working tree at audit time, including uncommitted changes.

## Source Map

- Page route: `app/(dashboard)/planning/page.tsx`
- Loading route: `app/(dashboard)/planning/loading.tsx`
- Client workspace: `app/(dashboard)/planning/planning-workspace.tsx`
- Sidebar navigation: `components/app-sidebar.tsx`
- Planning read auth: `lib/planning/auth.ts`
- Planning access predicate: `lib/authz.ts`
- Snapshot service: `lib/planning/service.ts`
- Snapshot/action types: `lib/planning/types.ts`
- Action schemas: `lib/schemas/planning.ts`
- Action implementation: `lib/planning/actions.ts`
- API routes:
  - `app/api/planning/route.ts`
  - `app/api/planning/actions/purchase-order/route.ts`
  - `app/api/planning/actions/purchase-orders/route.ts`
  - `app/api/planning/actions/manufacturing-order/route.ts`
- Fast UI tests: `test/e2e/fast/planning.spec.ts`

## Route And Access

The Planning page is at `/planning`.

The dashboard sidebar shows a top-level `Planning` nav item before Inventory.
It uses HugeIcons `ChartAnalysisIcon` and links directly to `/planning`. There
are no Planning subnav items.

Planning visibility requires `canReadPlanning(assignedRoles)`. That predicate
requires read access to all four modules:

- inventory
- sales
- manufacturing
- purchasing

The page calls `requirePlanningReadAccess()` before loading data. Unauthorized
users are redirected to their default dashboard path.

The server page also computes action permissions and passes them into the client
workspace:

```ts
permissions={{
  canCreatePurchaseOrders: hasModuleAccess(context.assignedRoles, "purchasing", "operate"),
  canCreateManufacturingOrders: hasModuleAccess(context.assignedRoles, "manufacturing", "operate"),
}}
```

The API routes enforce the same shape:

- `GET /api/planning` requires planning read access.
- `POST /api/planning/actions/purchase-order` requires planning read access and
  purchasing write access.
- `POST /api/planning/actions/purchase-orders` requires planning read access and
  purchasing write access.
- `POST /api/planning/actions/manufacturing-order` requires planning read
  access and manufacturing write access.

## Data Contract

The UI renders one `PlanningSnapshot`.

The server page fetches the initial snapshot with `getPlanningSnapshot()` and
passes it into `PlanningWorkspace` as `initialSnapshot`. The client keeps it
fresh through TanStack Query:

- query key: `["planning"]`
- query fn: `GET /api/planning`

Snapshot fields used by the UI:

- `generatedAt`: shown in the header as `Last updated {time}`
- `rows`: item-level planning rows
- `demandFacts`: demand detail, search text, blocked order grouping, needed-for
  summaries
- `supplyFacts`: advanced incoming supply detail
- `inventoryFacts`: advanced inventory calculation detail
- `bomRequirementFacts`: material readiness, BOM demand, component shortage
  counts
- `recommendations`: joined to rows through `row.recommendationId`

Snapshot fields currently not rendered directly:

- `orgId`
- `horizonStart`
- `horizonEnd`
- `inputHash`
- `assumptions`
- top-level `warnings`

## Planning Math Displayed

The UI does not compute the planning run. It displays and reshapes the snapshot
from `lib/planning/service.ts`.

The service includes:

- confirmed sales order lines
- safety stock targets
- remaining released manufacturing ingredient demand
- BOM explosion demand from parent shortages
- projected on-hand inventory
- open purchase order remaining quantities
- released manufacturing order remaining output

The row-level quantities are based on:

```text
projectedQuantity = onHand + incomingPurchaseOrders + incomingManufacturingOrders - demand
shortageQuantity = max(0, -projectedQuantity)
availableStock = max(0, onHand - reserved)
```

The UI shows item units using `unitUom` when present, otherwise `unitName`.

## Component State

`PlanningWorkspace` owns these state values:

- `search`: search input text
- `filter`: one of `buy`, `make`, `setup`, `blocked`
- `detailTarget`: the currently open detail drawer target, or `null`
- `actionError`: latest draft-action error message, or `null`

Default filter: `buy`.

Changing filters through `selectFilter()` also clears the open detail target.

There is no pagination and no user-controlled table sorting. Matching rows are
sorted by earliest required date first, then item name.

## Header

The header displays:

- H1: `Planning`
- subtitle: `Today's supply actions`
- timestamp: `Last updated {formatUpdatedAt(snapshot.generatedAt)}`
- refresh button

The refresh button:

- label: `Refresh plan`
- pending label: `Refreshing...`
- icon: `ArrowReloadHorizontalIcon`
- variant: `outline`
- disabled while `isFetching`
- calls `refetch()` on the `["planning"]` query

## Workflow Cards

Four summary cards appear below the header. Each card is clickable and keyboard
openable with Enter or Space.

Cards use `border-primary` when active.

### Buy Materials Card

- Label: `Buy materials`
- Value: `{summary.needsBuying} materials`
- Detail: `Create purchase orders`
- Click action: sets filter to `buy`

`needsBuying` counts attention rows where:

- `planningType === "buy"`
- row is not a setup issue

### Make Products Card

- Label: `Make products`
- Value: `{summary.needsMaking} items`
- Detail: `Create manufacturing orders`
- Click action: sets filter to `make`

`needsMaking` counts attention rows where:

- `planningType === "make"`
- row is not a setup issue

### Fix Setup Card

- Label: `Fix setup`
- Value: `{summary.setupIssues} issues`
- Detail: `Supplier, price, or BOM missing`
- Click action: sets filter to `setup`

`setupIssues` counts attention rows where `isSetupIssue(row)` is true.

### Blocked Orders Card

- Label: `Blocked orders`
- Value: `{summary.blockedOrders} orders`
- Detail: `See affected sales orders`
- Click action: sets filter to `blocked`

`blockedOrders` counts unique sales order labels across all attention rows.

Current behavior: card counts are computed from all operational rows. They do
not change when the search input is filled.

## Filter Bar

The filter control is a single-select shadcn `ToggleGroup`.

Visible filters:

- `Buy materials`
- `Make products`
- `Fix setup`
- `Blocked orders`

Accessibility labels are the same as the visible labels.

Filter behavior:

- `buy`: buy rows that are not setup issues
- `make`: make rows that are not setup issues
- `setup`: setup issue rows
- `blocked`: rows with at least one sales order source ref, grouped by sales
  order in the rendered table

There is no current `All` filter and no current `Ready` filter.

## Search

Search input:

- aria-label: `Search planning`
- placeholder: `Search items, orders, suppliers...`
- class: `w-full lg:w-80`

Search is applied before workflow filtering and only includes attention rows.

An attention row is any row that:

- has a recommendation, or
- has a shortage quantity greater than zero

Search is case-insensitive and matches:

- item name
- item SKU
- needed-for summary
- action label
- action summary
- status label
- suggested supplier name
- labels from all demand source refs

## Derived Operational Rows

Every `PlanningItemRow` is converted to an internal `OperationalRow`.

Each operational row contains:

- original planning row
- joined recommendation, if any
- demand facts for the item
- supply facts for the item
- inventory fact for the item
- BOM facts where the row item is the parent or component
- needed-for summary
- derived status label and badge variant
- derived action label
- derived action summary
- component shortage count
- attention flag
- late-risk flag

`componentShortageCount` counts distinct BOM components where the parent is the
current row item and the component's own row has shortage quantity greater than
zero.

`isLateRisk` is true when `earliestRequiredDate` is before the browser-local
current date.

## Needed-For Summary

`summarizeNeededFor()` uses this priority order:

- one sales order label
- `{n} sales orders`
- one manufacturing order label
- `{n} production orders`
- `Safety stock`
- `Parent shortages`
- `Demand`

## Status Labels

`getStatus()` derives badges for rows.

Setup recommendations:

- missing supplier -> `Supplier missing`, destructive
- ambiguous supplier -> `Supplier needed`, destructive
- missing purchase price -> `Price missing`, destructive
- missing BOM -> `BOM missing`, destructive
- other setup issue -> `Setup issue`, destructive

Manufacturing recommendations:

- component shortages exist -> `Materials short`, destructive
- no component shortages -> `Ready to build`, secondary

Purchase recommendations:

- create purchase order -> `Ready to order`, default

Fallback states:

- shortage without actionable recommendation -> `Blocked`, destructive
- no shortage -> `Covered`, secondary

## Setup Issue Detection

`isSetupIssue()` returns true when:

- recommendation type is `review_item_setup`, or
- the row reason codes include any of:
  - `missing_supplier`
  - `ambiguous_supplier`
  - `missing_purchase_price`
  - `missing_bom`
  - `bom_cycle_detected`
  - `bom_depth_limit`
  - `stale_recommendation`
  - `duplicate_draft_action`

`setupProblemLabel()` maps row reason codes to:

- `Missing supplier`
- `Choose supplier`
- `Missing price`
- `Missing BOM`
- `BOM cycle`
- `BOM too deep`
- `Draft exists`
- `Plan changed`
- fallback: `Review setup`

Current caveat: several setup labels inspect `row.reasonCodes`, while the
planning service currently puts some setup-specific codes on the recommendation
and warning objects. If the row itself does not contain the specific missing
code, the UI falls back to generic labels like `Setup issue`, `Review setup`,
or `Fix setup`.

## Action Labels

`getActionLabel()` derives the displayed row action text.

No recommendation:

- shortage exists -> `Review`
- no shortage -> `No action`

Purchase recommendation:

- suggested supplier exists -> `Create PO draft`
- no suggested supplier -> `Assign supplier`

Manufacturing recommendation:

- component shortages exist -> `Review shortages`
- no component shortages -> `Create MO draft`

Setup conditions:

- missing or ambiguous supplier -> `Assign supplier`
- missing purchase price -> `Add price`
- missing BOM, BOM cycle, or BOM depth issue -> `Fix BOM`
- fallback -> `Fix setup`

## Permission-Aware Actions

The UI now blocks draft action execution unless the user has the required
module operation permission.

`canExecuteAction(row, permissions)` returns true only when:

- row has an action payload, and
- purchase payload plus `permissions.canCreatePurchaseOrders`, or
- manufacturing payload plus `permissions.canCreateManufacturingOrders` and
  `componentShortageCount === 0`

Manufacturing rows with missing component materials cannot execute directly
from Planning even if an action payload exists. They open the detail drawer for
review instead.

Read-only purchase groups show `Read only` where a create button would
otherwise appear.

## Openable Rows And Drawer

Rows are no longer expanded inline. Details open in a right-side shadcn `Sheet`.

Open behavior:

- table rows have `tabIndex=0`
- clicking a row opens detail
- pressing Enter or Space on a row opens detail
- each row also has an icon button with aria-label `Open {label}`
- the icon is `ArrowRight01Icon`

`detailTarget` stores one of:

- `{ kind: "buy", key }`
- `{ kind: "row", key }`
- `{ kind: "blocked", key }`

The drawer:

- uses `Sheet`
- uses `SheetContent className="w-full gap-0 sm:max-w-2xl"`
- title is supplier name, item name, blocked order label, or `Planning`
- description depends on target:
  - buy group: `{n} material(s) need buying`
  - row: `Need {shortage quantity} by {date}`
  - blocked order: `Due {date}`
- has a `Separator` under the header
- body is wrapped in `ScrollArea`
- closing the sheet clears `detailTarget`

## Buy Materials Table

The `buy` filter renders `BuyGroupsTable`.

Rows are grouped by supplier id from the purchase action payload. If no payload
exists, the row uses the fallback group key `missing_supplier`.

Columns:

- `Supplier`
- `Items`
- `Earliest need`
- `Sales orders affected`
- `Action`

Supplier cell:

- open-detail icon button
- supplier name
- preview of the first two item names
- `+ {n} more` when more than two items are grouped

Items cell:

- number of grouped rows

Earliest need cell:

- `NeededByCell`, which shows short date and urgency line

Sales orders affected cell:

- unique sales order count across rows in the supplier group

Action cell:

- if group has payloads and user can create purchase orders: `Create PO draft`
- if group has no payloads: outline `Assign supplier`
- if group has payloads but user cannot create purchase orders: `Read only`

Empty state:

```text
No buying actions match the current filters.
```

Clicking `Create PO draft` posts all payloads in the supplier group to:

```text
POST /api/planning/actions/purchase-orders
```

## Buy Group Drawer

The buy group drawer renders `BuyGroupDrawerContent`.

Sections:

- `Decision`
- `Materials`

Decision section:

- text: `Create one purchase order for {n} material(s).`
- inline facts:
  - `Earliest need: {date}`
  - `{n} sales orders affected`
- action:
  - `Create PO draft` button when payloads exist and user has purchase write
    access
  - `Assign a supplier before creating a purchase order.` when no payloads
    exist
  - `You have read-only purchasing access.` when payloads exist but user lacks
    purchase write access

Materials table columns:

- `Item`
- `Need`
- `Needed by`
- `Needed for`

## Make Products Table

The `make` filter renders `MakeRowsTable`.

Columns:

- `Item`
- `Build qty`
- `Needed by`
- `Material status`
- `Action`

Item cell:

- open-detail icon button
- item name
- item type label

Material status:

- `Missing {n} materials` when `componentShortageCount > 0`
- `Ready` otherwise

Action cell:

- uses `RowActionButton`
- can create MO drafts only when user can create manufacturing orders and
  component shortage count is zero
- otherwise opens the drawer for review

Empty state:

```text
No make actions match the current filters.
```

## Fix Setup Table

The `setup` filter renders `SetupRowsTable`.

Columns:

- `Problem`
- `Item`
- `Why it matters`
- `Action`

Problem cell:

- destructive badge from `setupProblemLabel(entry)`

Item cell:

- open-detail icon button
- item name

Why it matters:

- `entry.neededFor`

Action:

- outline button using `entry.actionLabel`
- button opens the drawer
- no draft action is executed from this table

Empty state:

```text
No setup issues match the current filters.
```

## Blocked Orders Table

The `blocked` filter renders `BlockedOrdersTable`.

Rows are grouped by sales order source id. Each row represents one sales order,
not one item.

Columns:

- `Sales order`
- `Due date`
- `Blocking items`
- `Action`

Sales order cell:

- open-detail icon button
- sales order label

Due date:

- earliest date across the grouped sales order source refs and row required
  dates

Blocking items:

- number of grouped operational rows blocking the sales order

Action:

- outline `Review` button
- opens the blocked order drawer

Empty state:

```text
No blocked orders match the current filters.
```

Current behavior: blocked order rows only come from rows with sales order source
refs. Safety-stock-only and production-only issues are not represented in this
table unless their demand source refs include a sales order.

## Item Drawer

Single item rows open `PlanningRowDrawerContent`.

Top badges:

- derived status badge
- `Late risk` badge when `isLateRisk` is true

Sections:

- `Recommended next step`
- `Why this matters`
- `Availability`
- `Supplier`, only when `suggestedSupplierName` exists
- `Material readiness`, only for make rows
- collapsible advanced details

### Recommended Next Step

Shows:

- `planningRow.actionSummary`
- action button when `planningRow.recommendation.actionPayload` exists and
  `canExecuteAction()` is true
- missing-material guidance when `componentShortageCount > 0`

The missing-material guidance text is:

```text
Cover the missing materials before creating the manufacturing order.
```

### Why This Matters

Renders `DemandSummary`.

If sales order source refs exist:

- shows `Needed for {n} sales order(s).`
- renders a table with columns:
  - `Sales order`
  - `Qty`
  - `Needed by`
- displays up to six sales orders
- if more than six exist, shows `Showing 6 of {n} sales orders.`

If no sales order refs exist:

- displays the `summarizeNeededFor()` text as muted text

### Availability

Renders `AvailabilitySummary`.

Fields:

- `Need`: `row.demandQuantity`
- `Available`: `row.availableStock`
- `Incoming`: purchase incoming plus manufacturing incoming
- `Short`: `row.shortageQuantity`

### Supplier

Shown only when the recommendation has `suggestedSupplierName`.

Text:

```text
{supplierName} is the last used supplier.
```

Current caveat: the text always says the supplier is the last used supplier.
The service can also suggest the sole active supplier when no item-specific
history exists.

### Material Readiness

Shown only for rows where `planningType === "make"`.

Renders `ShortMaterialsList`.

If no short components exist:

```text
All required materials are available.
```

If short components exist:

- text: `{n} material is/are short.`
- table columns:
  - `Material`
  - `Short`
  - `Next step`
- next step is hardcoded as `Add to PO`

Current behavior: the `Add to PO` text is not an action and is not a link.

## Advanced Details

Advanced detail is hidden behind a `Collapsible` trigger button:

```text
Show calculation
```

When open, it can show:

- `Inventory calculation`
- `Incoming supply`, only when supply facts exist
- `BOM demand`, only when BOM facts exist
- `Planning signals`
- `Related records`

### Inventory Calculation

Columns:

- `On hand`
- `Available`
- `Reserved`
- `Incoming PO`
- `Incoming MO`
- `Projected`

### Incoming Supply

Columns:

- `Supply`
- `Qty`
- `Expected`
- `Status`

Supply labels:

- `available_inventory` -> `On hand`
- `purchase_order` -> `Purchase order`
- `manufacturing_order` -> `Manufacturing order`

Empty state exists in the table component but this section is only rendered
when supply facts exist.

### BOM Demand

Columns:

- `Component`
- `Needed`
- `Parent item`

Each component cell can include:

- component name
- `Short {quantity}` if the component row exists

Empty state exists in the table component but this section is only rendered
when BOM facts exist.

### Planning Signals

Displays reason badges from `planningRow.row.reasonCodes`.

Reason labels:

- `sales_order_demand` -> `Needed for sales orders`
- `safety_stock_demand` -> `Safety stock target`
- `manufacturing_component_demand` -> `Needed for production`
- `bom_component_demand` -> `Needed by a BOM`
- `open_purchase_supply` -> `Incoming purchase order`
- `open_manufacturing_supply` -> `Incoming manufacturing order`
- `inventory_available` -> `Stock available`
- `reserved_stock` -> `Already reserved`
- `projected_shortage` -> `Not enough stock`
- `no_shortage` -> `Covered`
- `buy_item` -> `Buy item`
- `make_item` -> `Make item`
- `missing_supplier` -> `Supplier needed`
- `ambiguous_supplier` -> `Choose supplier`
- `missing_purchase_price` -> `Purchase price needed`
- `missing_bom` -> `BOM needed`
- `bom_cycle_detected` -> `BOM cycle detected`
- `bom_depth_limit` -> `BOM depth limit reached`
- `stale_recommendation` -> `Plan changed`
- `duplicate_draft_action` -> `Draft already exists`

Badge variant rules:

- codes containing `missing`, `ambiguous`, `shortage`, `stale`, or `duplicate`
  are destructive
- codes containing `supply`, plus `inventory_available` and `no_shortage`, are
  secondary
- all others are outline

### Related Records

Displays unique source refs from the row, excluding:

- `item`
- `planning_recommendation`

Each related record displays:

- label
- quantity, when present
- date, when present

Current behavior: related records are plain text. They are not links to source
records.

## Blocked Order Drawer

Blocked order rows open `BlockedOrderDrawerContent`.

Sections:

- `Decision`
- `Blocking items`

Decision text:

```text
{n} blocking item(s) need attention for this sales order.
```

Blocking items table columns:

- `Item`
- `Need`
- `Status`
- `Next step`

The drawer does not expose draft action buttons for individual blocking items.
It lists the next step text from each row's action label.

## Date And Urgency Display

`NeededByCell` shows:

- short date from `formatShortDate(value)`
- urgency from `urgencyLabel(value)`

Short date:

- no date -> `No date`
- date -> US short month and day, for example `Apr 25`

Urgency:

- no date -> `No date`
- past date -> `{n}d overdue`
- today -> `Today`
- tomorrow -> `Tomorrow`
- future date -> `in {n}d`

Date math uses browser-local `new Date()` and resets today to midnight.

## Draft Action Flows

### Single Purchase Draft

Endpoint:

```text
POST /api/planning/actions/purchase-order
```

Triggered from item-level action buttons when:

- action payload is `create_purchase_order`
- user has purchase-order create permission

On success:

- invalidate `["planning"]`
- invalidate `["purchase-orders"]`
- navigate to `/purchasing/orders/{id}`

### Group Purchase Draft

Endpoint:

```text
POST /api/planning/actions/purchase-orders
```

Triggered from:

- buy group table `Create PO draft`
- buy group drawer `Create PO draft`

Payload:

```ts
{ actions: CreatePurchaseOrderDraftActionPayload[] }
```

On success:

- invalidate `["planning"]`
- invalidate `["purchase-orders"]`
- if one order is returned, navigate to `/purchasing/orders/{id}`
- if multiple orders are returned, navigate to `/purchasing/orders`

The action implementation groups submitted actions by supplier id and creates
one draft PO per supplier.

### Manufacturing Draft

Endpoint:

```text
POST /api/planning/actions/manufacturing-order
```

Triggered from item-level action buttons when:

- action payload is `create_manufacturing_order`
- user has manufacturing create permission
- component shortage count is zero

On success:

- invalidate `["planning"]`
- invalidate `["manufacturing-orders"]`
- navigate to `/manufacturing/orders/{id}`

## Server-Side Action Validation

Before creating a draft, the server rebuilds the planning snapshot and verifies
the recommendation still matches the submitted payload.

Validation checks:

- recommendation id
- recommendation type
- item id
- quantity
- required date
- action type
- supplier id and unit cost for purchase actions
- BOM revision id and ingredient list for manufacturing actions

If the recommendation changed or disappeared, the API returns `409`.

Created drafts include a marker in notes:

```text
[planning-recommendation:{recommendationId}]
```

Duplicate draft protection searches active draft/ordered/partial purchase
orders or draft/released manufacturing orders for that marker and rejects
repeat creation with `409`.

## Loading State

`app/(dashboard)/planning/loading.tsx` renders a route-level skeleton with:

- header title skeleton
- header subtitle/timestamp skeleton
- refresh button skeleton
- four summary-card skeletons
- filter/search toolbar skeletons
- bordered table skeleton with eight rows

## Error State

Draft action errors are stored in `actionError`.

The error alert renders above the active table:

- `role="alert"`
- destructive border/background/text token classes
- API error message when available
- fallback messages:
  - `Failed to create draft.`
  - `Failed to create purchase drafts.`

The planning query itself throws `Failed to fetch planning snapshot` when
`GET /api/planning` fails. There is no custom inline query-error panel in the
workspace.

## Empty States

Table empty states:

- buy table: `No buying actions match the current filters.`
- make table: `No make actions match the current filters.`
- setup table: `No setup issues match the current filters.`
- blocked table: `No blocked orders match the current filters.`
- supply facts table: `No open supply found.`
- BOM facts table: `No component demand found.`
- related records: `No related records.`

Demand summary does not have a table empty state in the current drawer. If no
sales orders exist, it falls back to text from `summarizeNeededFor()`.

## Current Test Coverage

`test/e2e/fast/planning.spec.ts` covers current UI behavior including:

- loading `/planning`
- searching planning by item SKU
- seeing a grouped supplier row in the buy workflow
- opening a supplier detail drawer
- verifying drawer title and materials table
- creating a suggested PO draft through `/api/planning/actions/purchase-orders`
- navigating to the created PO detail page
- verifying draft PO status, supplier, notes marker, and lines in the database
- grouping multiple purchase recommendations by supplier
- creating one draft PO with multiple lines from the buy tab

The same spec also covers planning API/domain behavior outside the UI:

- snapshot rows and recommendations
- BOM explosion
- purchase and manufacturing draft creation APIs
- duplicate draft protection
- concurrent duplicate protection
- cross-org isolation

## Not Currently Present In The UI

- No full all-items view.
- No ready/covered view.
- No persisted planning run history.
- No forecast controls.
- No horizon/date-range controls.
- No capacity or finite scheduling UI.
- No lead-time offset display.
- No inline edit for recommendation quantity, date, supplier, unit cost, or BOM.
- No manual supplier picker.
- No direct item setup repair links from Planning.
- No confirmation dialog before creating drafts.
- No links from related record labels to sales orders, purchase orders,
  manufacturing orders, or BOM revisions.
- No display of top-level `snapshot.warnings`.
- No display of `snapshot.assumptions`.
- No display of `inputHash`.
- No optimistic UI updates after draft action.
- No pagination.
- No user-controlled sorting.

## Current Developer Caveats

- Some setup-specific labels use `row.reasonCodes`, but setup codes can live on
  `recommendation.reasonCodes` and `recommendation.warnings`. This can produce
  generic setup labels even when the backend knows the exact issue.
- Supplier drawer copy says the supplier is "the last used supplier", but the
  service may also suggest the sole active supplier.
- `ShortMaterialsList` says `Add to PO`, but that is text only.
- The blocked-order drawer does not provide per-item action buttons, only next
  step labels.
- Top-level warnings and assumptions exist in the snapshot but have no UI.
- Related records are not clickable.
- Summary card counts ignore the current search string.
- Grouped PO creation can return multiple orders, but the current buy grouping
  normally groups by supplier and sends one supplier group at a time.
