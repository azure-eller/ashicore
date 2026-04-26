---
read_when:
  - Auditing the current Planning UI
  - Handing off the MRP-lite planning action queue to another developer
  - Changing planning ready queues, attention queue, search, detail drawer, or draft actions
---

# Planning UI Audit - 2026-04-26

This audit describes the current Planning UI in the `planning-mrp-lite`
worktree. It reflects the current working tree at audit time, including
uncommitted changes.

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

## High-Level UI Shape

The Planning page is currently an action queue, not a tabbed dashboard and not a
table-first workspace.

The page has:

- a header with ready/action counts and refresh
- one search input
- a `Ready to do` section
- a nested `Purchase orders` queue
- a nested `Manufacturing orders` queue
- a `Needs attention` queue
- a right-side detail drawer for purchase groups and individual item rows

There are no workflow cards, no filter tabs, no inline expanded rows, and no
blocked-order table in the current UI.

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

The server page computes action permissions and passes them to the client:

```ts
permissions={{
  canCreatePurchaseOrders: hasModuleAccess(context.assignedRoles, "purchasing", "operate"),
  canCreateManufacturingOrders: hasModuleAccess(context.assignedRoles, "manufacturing", "operate"),
}}
```

The API routes also enforce permissions:

- `GET /api/planning` requires planning read access.
- `POST /api/planning/actions/purchase-order` requires planning read access and
  purchasing write access.
- `POST /api/planning/actions/purchase-orders` requires planning read access and
  purchasing write access.
- `POST /api/planning/actions/manufacturing-order` requires planning read
  access and manufacturing write access.

## Data Contract Used By The UI

The UI renders one `PlanningSnapshot`.

The server page fetches the initial snapshot through `getPlanningSnapshot()`.
The client refreshes it through TanStack Query:

- query key: `["planning"]`
- query endpoint: `GET /api/planning`

Snapshot fields used directly by the current UI:

- `generatedAt`: header timestamp
- `rows`: item-level planning rows
- `demandFacts`: needed-for summaries, sales order counts, drawer demand lines,
  and search text
- `bomRequirementFacts`: component shortage counts and material-short drawer
  content
- `recommendations`: joined to rows through `row.recommendationId`

Snapshot fields currently not rendered directly:

- `orgId`
- `horizonStart`
- `horizonEnd`
- `inputHash`
- `assumptions`
- `supplyFacts`
- `inventoryFacts`
- top-level `warnings`

The previous audit included advanced inventory/supply calculation UI. That UI
is no longer present in the current `planning-workspace.tsx`.

## Planning Math Context

The planning service still builds rows from:

- confirmed sales order lines
- safety stock targets
- remaining released manufacturing ingredient demand
- BOM explosion demand from parent shortages
- projected on-hand inventory
- open purchase order remaining quantities
- released manufacturing order remaining output

The row quantities are based on:

```text
projectedQuantity = onHand + incomingPurchaseOrders + incomingManufacturingOrders - demand
shortageQuantity = max(0, -projectedQuantity)
availableStock = max(0, onHand - reserved)
```

The current UI only displays the resulting shortage, need, dates, sales-order
counts, and material shortage lists. It does not expose the full inventory math
or incoming supply facts.

## Component State

`PlanningWorkspace` owns:

- `search`: search input value
- `detailTarget`: current drawer target or `null`
- `actionError`: latest draft-action error or `null`

There is no filter state.

`detailTarget` can be:

- `{ kind: "buy", key }`
- `{ kind: "row", key }`

There is no current blocked-order drawer target.

## Header

The header displays:

- H1: `Planning`
- ready summary:
  - `Ready: {n} purchase order(s), {n} manufacturing order(s)`
- attention summary:
  - `Needs attention: {n} blocker(s) - {n} order(s) affected`
- timestamp:
  - `Last updated {formatUpdatedAt(snapshot.generatedAt)}`
- `Refresh plan` button

The refresh button:

- variant: `outline`
- icon: `ArrowReloadHorizontalIcon`
- label while idle: `Refresh plan`
- label while fetching: `Refreshing...`
- disabled while fetching
- calls `refetch()` for the `["planning"]` query

Summary counts are based on all current queue rows. They do not change when the
search box is filled.

## Search

There is one search input, aligned to the right on large screens.

Search input:

- aria-label: `Search planning`
- placeholder: `Search items, orders, suppliers...`
- class: `w-full lg:w-80`

Search is applied to queue rows before the ready and attention queues are
derived.

Search is case-insensitive and matches:

- item name
- item SKU
- needed-for summary
- action label
- action summary
- status label
- suggested supplier name
- demand source-ref labels

There are no filter buttons or summary cards.

## Operational Row Model

Each `PlanningItemRow` becomes an `OperationalRow` with:

- `row`: the original planning row
- `recommendation`: joined recommendation or null
- `demandFacts`: demand facts for the item
- `bomFacts`: BOM facts where this item is either parent or component
- `neededFor`: summarized demand label
- `statusLabel`: derived status string
- `actionLabel`: derived button/next-step label
- `actionSummary`: derived detail sentence
- `componentShortageCount`: count of short BOM components for make rows
- `isAttention`: true when a recommendation exists or shortage quantity is
  greater than zero

Current UI no longer stores `supplyFacts`, `inventoryFact`, badge variants, or
late-risk state in operational rows.

## Queue Rows And Sorting

`queueRows` are all operational rows where `isAttention` is true.

`queueRows` are sorted by:

1. earliest required date, with no date last
2. item name

`matchingRows` are `queueRows` filtered by the search string.

The rendered sections derive from `matchingRows`:

- `buyGroups`: grouped ready purchase rows
- `readyMakeRows`: ready manufacturing rows
- `attentionRows`: all non-ready blockers

## Ready Purchase Rows

`isReadyPurchaseRow(row)` is true when:

- `row.row.planningType === "buy"`
- row is not a setup issue
- recommendation action payload type is `create_purchase_order`

Ready purchase rows are grouped by supplier through `buildBuyGroups()`.

Each buy group contains:

- supplier key
- supplier name
- rows in the group
- purchase action payloads
- earliest required date
- affected sales order count

Group key is `purchasePayload.supplierId`.

Supplier name is `recommendation.suggestedSupplierName`, falling back to
`Preferred supplier`.

## Ready Manufacturing Rows

`isReadyManufacturingRow(row)` is true when:

- `row.row.planningType === "make"`
- row is not a setup issue
- `componentShortageCount === 0`
- recommendation action payload type is `create_manufacturing_order`

Ready manufacturing rows can create manufacturing drafts only when the user has
manufacturing operate access.

## Attention Rows

`isAttentionBlocker(row)` is true when:

- row is an attention row
- row is not a ready purchase row
- row is not a ready manufacturing row

This queue captures setup issues, short materials, and any other shortage or
recommendation state that cannot be immediately executed.

## Action Labels

`getActionLabel()` returns:

- no recommendation and shortage exists -> `Review`
- no recommendation and no shortage -> `No action`
- purchase recommendation with supplier -> `Create PO`
- purchase recommendation without supplier -> `Assign supplier`
- manufacturing recommendation with component shortages -> `Review shortages`
- manufacturing recommendation without component shortages -> `Create MO`
- missing or ambiguous supplier -> `Assign supplier`
- missing purchase price -> `Add price`
- missing BOM, BOM cycle, or BOM depth issue -> `Fix BOM`
- fallback -> `Fix setup`

## Status Labels

`getStatus()` returns a plain string:

- missing supplier -> `Supplier missing`
- ambiguous supplier -> `Supplier needed`
- missing purchase price -> `Price missing`
- missing BOM -> `BOM missing`
- other setup issue -> `Setup issue`
- manufacturing with component shortages -> `Materials short`
- manufacturing ready -> `Ready to build`
- purchase ready -> `Ready to order`
- shortage without action -> `Blocked`
- otherwise -> `Covered`

Current UI caveat: `statusLabel` is used in search text but is not visibly
displayed as a general status column or badge except through attention labels.

## Setup Issue Detection

`isSetupIssue()` returns true when:

- recommendation type is `review_item_setup`, or
- row reason codes include any of:
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

`attentionProblemLabel()` returns:

- `Materials short` for make rows with component shortages
- otherwise `setupProblemLabel(row)`

Current caveat: several specific setup labels inspect `row.reasonCodes`, while
the planning service may place setup-specific codes on recommendation warnings.
When row-level reason codes are generic, the UI can fall back to `Review setup`.

## Ready To Do Section

The main body starts with `Ready to do`.

Summary text:

```text
{n} purchase order(s) and {n} manufacturing order(s) can be created now.
```

It contains two nested action sections:

- `Purchase orders`
- `Manufacturing orders`

## Purchase Orders Queue

Rendered by `PurchaseOrderQueue`.

If there are no ready purchase groups:

```text
No purchase orders are ready to create.
```

Otherwise it renders a bordered, divided list with `role="list"`.

Each group row:

- is a `div` with `role="listitem"`
- is clickable
- is keyboard openable with Enter or Space
- opens the purchase-order drawer
- has `hover:bg-muted/50` and `focus-visible:bg-muted/50`

Accessible list item label includes:

- supplier name
- number of lines
- needed-by date

Visible row content:

- `Open {supplierName}` ghost icon button with `ArrowRight01Icon`
- supplier name
- `{n} line(s) - Needed by {date} - {n} order(s) affected`
- `Create PO` button when user can create purchase orders
- `Read only` text when user lacks purchase create permission

Clicking `Create PO` posts the group's action payloads to:

```text
POST /api/planning/actions/purchase-orders
```

## Manufacturing Orders Queue

Rendered by `ManufacturingOrderQueue`.

If there are no ready manufacturing rows:

```text
No manufacturing orders are ready to create.
```

Otherwise it renders a bordered, divided list with `role="list"`.

Each row:

- is a `div` with `role="listitem"`
- is clickable
- is keyboard openable with Enter or Space
- opens the manufacturing row drawer

Accessible list item label includes:

- item name
- build quantity
- needed-by date

Visible row content:

- `Open {itemName}` ghost icon button with `ArrowRight01Icon`
- item name
- `Build {qty} - Needed by {date} - {n} order(s) affected`
- `Create MO` button when user can create manufacturing orders
- `Read only` text when user lacks manufacturing create permission

Clicking `Create MO` posts the row action payload to:

```text
POST /api/planning/actions/manufacturing-order
```

## Needs Attention Section

Rendered by `AttentionQueue`.

Section summary:

```text
{n} blocker(s) need review before action.
```

If there are no attention rows:

```text
No blockers need attention.
```

Otherwise it renders a bordered, divided list with `role="list"`.

Each row:

- is clickable
- is keyboard openable with Enter or Space
- opens the row detail drawer
- has a destructive badge from `attentionProblemLabel(row)`
- shows impact text from `attentionImpact(row)`
- has an outline action button with `row.actionLabel`, or `Review` when the
  action label is `No action`

`attentionImpact(row)` returns:

- `{n} material(s) short` for make rows with component shortages
- `Blocking {n} order(s)` when sales order source refs exist
- otherwise the row's `neededFor` summary

## Detail Drawer

Details open in a right-side shadcn `Sheet`.

`SheetContent` classes:

```text
w-full gap-0 sm:max-w-2xl
```

The drawer body uses `ScrollArea` with a padded content wrapper.

Drawer title logic:

- buy group -> `Create purchase order`
- ready manufacturing row -> `Create manufacturing order`
- make row with component shortages -> `Cannot build yet`
- anything else -> `Needs attention`

Drawer description:

- buy group -> supplier name
- row -> item name

Closing the sheet clears `detailTarget`.

## Purchase Order Drawer

Rendered by `BuyGroupDrawerContent`.

Top content:

- supplier name
- `{n} line(s) - Earliest need {date} - {n} order(s) affected`
- `Create PO` button when payloads exist and user can create purchase orders
- read-only message otherwise

Read-only message:

```text
You have read-only purchasing access.
```

Lines table columns:

- `Item`
- `Need`
- `Needed by`
- `Needed for`

Clicking drawer `Create PO` posts the group's payloads to:

```text
POST /api/planning/actions/purchase-orders
```

## Item Drawer

Rendered by `PlanningRowDrawerContent`.

Top area:

- destructive badge for non-ready-build rows
- item name
- contextual summary text
- action button when an action payload exists and `canExecuteAction()` is true

For ready manufacturing rows, summary text is:

```text
Build {qty} - Needed by {date} - {n} order(s) affected
```

For blocked manufacturing rows, summary text is:

```text
Need {qty} by {date}.
```

For other attention rows, summary text is `attentionImpact(row)`.

The action button uses:

- `Create PO` for purchase payloads
- `Create MO` for manufacturing payloads
- the row's `actionLabel`

## Item Drawer Demand Content

For non-blocked-build rows, the drawer renders `DemandLinesTable`.

If sales order source refs exist:

- heading: `Needed for`
- table columns:
  - `Sales order`
  - `Qty`
  - `Needed by`
- shows up to six sales order rows
- if more than six exist, shows:

```text
Showing 6 of {n} sales orders.
```

If no sales order refs exist, the drawer shows the `summarizeNeededFor()` text
as muted text.

## Item Drawer Short Materials Content

For make rows with component shortages, the drawer renders `ShortMaterialsList`
instead of the sales order demand table.

If no shortages are found:

```text
All required materials are available.
```

If shortages exist:

- heading: `{n} material is short` or `{n} materials are short`
- table columns:
  - `Material`
  - `Short`
  - `Next step`
- next step text is always `Add to PO`

Current behavior: `Add to PO` is text only. It is not a button or link.

## Date And Count Formatting

Needed-by dates:

- no date -> `No date`
- date -> US short month/day, for example `Apr 26`

Urgency text from `NeededByCell`:

- no date -> `No date`
- past date -> `{n}d overdue`
- today -> `Today`
- tomorrow -> `Tomorrow`
- future date -> `in {n}d`

The current queue rows mostly show short dates directly. `NeededByCell` is used
inside drawer line tables.

Count helpers:

- `formatCount(count, "purchase order")`
- `formatCount(count, "manufacturing order")`
- `formatCount(count, "line")`
- `formatOrderCount(count)`

## Draft Action Flows

### Group Purchase Draft

Endpoint:

```text
POST /api/planning/actions/purchase-orders
```

Triggered from:

- purchase queue row `Create PO`
- purchase drawer `Create PO`

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

### Single Purchase Draft

Endpoint still exists:

```text
POST /api/planning/actions/purchase-order
```

The current UI's ready purchase flow uses grouped purchase drafts, not this
single-action endpoint.

### Manufacturing Draft

Endpoint:

```text
POST /api/planning/actions/manufacturing-order
```

Triggered from:

- manufacturing queue row `Create MO`
- ready manufacturing drawer action button

On success:

- invalidate `["planning"]`
- invalidate `["manufacturing-orders"]`
- navigate to `/manufacturing/orders/{id}`

## Server-Side Action Safety

Before creating a draft, the server rebuilds the planning snapshot and verifies
that the submitted recommendation still matches:

- recommendation id
- recommendation type
- item id
- quantity
- required date
- action type
- supplier id and unit cost for purchase actions
- BOM revision id and ingredient list for manufacturing actions

If the recommendation changed or disappeared, the API returns `409`.

Created drafts include a notes marker:

```text
[planning-recommendation:{recommendationId}]
```

Duplicate draft protection searches active purchase/manufacturing drafts for
that marker and rejects repeated creation.

## Loading State

`app/(dashboard)/planning/loading.tsx` renders a route-level skeleton matching
the current queue UI:

- header title skeleton
- three header summary skeletons
- refresh button skeleton
- search skeleton
- three action-section skeletons
- each section has heading/summary skeletons and a bordered divided list

## Error State

Draft action errors are stored in `actionError`.

The error alert renders above the queue sections:

- `role="alert"`
- destructive border/background/text token classes
- API error message when available
- fallback messages:
  - `Failed to create draft.`
  - `Failed to create purchase drafts.`

The planning query throws `Failed to fetch planning snapshot` when
`GET /api/planning` fails. There is no custom inline query-error panel.

## Current UI Test Coverage

`test/e2e/fast/planning.spec.ts` covers:

- loading `/planning`
- searching planning by item SKU
- finding a supplier `listitem`
- seeing `1 line` or `2 lines`
- opening the purchase drawer by `Open {supplierName}`
- drawer title `Create purchase order`
- drawer `Lines` table
- creating PO drafts through `/api/planning/actions/purchase-orders`
- navigating to the created PO detail page
- verifying draft PO status, supplier, notes marker, and lines in the database
- grouping multiple ready purchase recommendations by supplier into one draft
  PO with multiple lines

The same spec also covers planning API/domain behavior outside this UI:

- snapshot rows and recommendations
- BOM explosion
- purchase and manufacturing draft creation APIs
- duplicate draft protection
- concurrent duplicate protection
- cross-org isolation

## Not Currently Present In The UI

- No workflow cards.
- No filter tabs.
- No all-items table.
- No ready/covered view.
- No blocked sales order table.
- No inline row expansion.
- No advanced inventory calculation display.
- No incoming supply display.
- No planning signal badge display.
- No related records display.
- No global warning panel for `snapshot.warnings`.
- No display of `snapshot.assumptions`.
- No display of `inputHash`.
- No persisted planning run history.
- No forecast controls.
- No horizon/date-range controls.
- No capacity or finite scheduling UI.
- No lead-time offset display.
- No inline edit for recommendation quantity, date, supplier, unit cost, or BOM.
- No manual supplier picker.
- No direct setup repair links from Planning.
- No confirmation dialog before creating drafts.
- No optimistic UI updates after draft action.
- No pagination.
- No user-controlled sorting.

## Current Developer Caveats

- The UI is intentionally simplified to an action queue, but the snapshot still
  contains richer diagnostic data that is no longer surfaced.
- Specific setup labels depend on `row.reasonCodes`; recommendation-level
  warnings may be more specific than the visible label.
- `Add to PO` in the short-materials drawer is not actionable.
- The search input filters the queues, but header summary counts remain based
  on the full queue.
- Purchase rows use grouped draft creation even for one line.
- The single purchase draft endpoint still exists but is not used by the
  current ready purchase queue.
- Related source records are not linked anywhere in the current UI.
