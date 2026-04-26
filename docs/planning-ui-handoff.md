---
read_when:
  - Auditing or redesigning the planning UI
  - Changing planning action queues, drawer details, or draft action buttons
  - Working on MRP-lite planning workspace behavior
---

# Planning UI Handoff

This is the repo-ready version of the designer handoff from:

`/home/aeller/Downloads/MRP planning page.zip`

The zip is a visual reference, not production code. Do not copy its HTML, inline
Babel, CSS, app shell, routes, fonts, icon set, mock data model, or raw table
markup into this repository.

## Intent

Keep Planning as an operational action queue:

- What can I create now?
- What is blocking me?
- Which sales orders are affected?

The designer's Production and Replenishment concepts should be translated into
the current single `/planning` workspace:

- production = ready manufacturing drafts and blocked builds
- replenishment = ready purchase drafts and purchasing setup blockers

Do not split the feature into `/planning/production` and
`/planning/replenishment` for this pass.

## Hard Boundaries

- Scope is `app/(dashboard)/planning/*` and planning-specific docs/tests only.
- Do not change the dashboard sidebar, topbar, navigation, or route structure.
- Keep the route at `/planning`.
- Use the current `PlanningSnapshot` contract from `lib/planning/types.ts`.
- Do not invent backend fields from the mock design data.
- Use existing shadcn components and local UI primitives.
- Use HugeIcons only. Never add Lucide or inline prototype icons.
- Use existing Figtree/global typography. Do not add Geist or Google Fonts.
- Use semantic tokens only. Do not hardcode Tailwind colors or copy prototype
  HSL values into component classes.
- Do not create a new data table component. Use the existing shadcn `Table` for
  drawer tables. If a full list-table screen is later needed, start from
  `DashboardDataTable`.
- Do not add server actions. Planning mutations stay behind API routes.

## Source Map

- Route: `app/(dashboard)/planning/page.tsx`
- Loading shell: `app/(dashboard)/planning/loading.tsx`
- Client workspace: `app/(dashboard)/planning/planning-workspace.tsx`
- Planning auth: `lib/planning/auth.ts`
- Planning data contract: `lib/planning/types.ts`
- Snapshot builder: `lib/planning/service.ts`
- Draft actions: `lib/planning/actions.ts`
- Action validation: `lib/schemas/planning.ts`
- API refresh: `app/api/planning/route.ts`
- Single PO action: `app/api/planning/actions/purchase-order/route.ts`
- Bulk PO action: `app/api/planning/actions/purchase-orders/route.ts`
- MO action: `app/api/planning/actions/manufacturing-order/route.ts`
- Browser coverage: `test/e2e/fast/planning.spec.ts`

## Component Mapping

| Prototype element | Repo implementation |
| --- | --- |
| custom sidebar/topbar/chrome | Existing dashboard layout only; no planning change |
| `PageHeader` | Local flex header in `PlanningWorkspace` |
| `.btn` | `Button` with `size="sm"` or `size="xs"` |
| custom icons / Lucide note | HugeIcons from `@hugeicons/core-free-icons` |
| `.input` | `Input` |
| `.card` / `.surface` | `Card size="sm"` or plain bordered `div` only when the card is the list surface |
| status chips | `Badge` variants: `secondary`, `outline`, `destructive` |
| production/replenishment tabs | Do not add route tabs in this pass |
| work-order cards | Compact ready-action rows in the `Ready` queue |
| replenishment table | Ready PO groups plus purchase drawer line table |
| raw `<table>` | shadcn `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableCell` |
| right-side detail panel | shadcn `Sheet` |
| fixed bulk bar | Defer unless row selection is explicitly implemented |

## Data Contract

Render from the current `PlanningSnapshot` only:

- `generatedAt`
- `rows`
- `demandFacts`
- `bomRequirementFacts`
- `recommendations`
- `inputHash` through action payloads

The current UI can derive:

- ready purchase groups by supplier
- ready manufacturing rows
- blocker groups by problem type
- earliest required date
- affected sales-order count from demand source refs
- build/buy quantities and units
- short BOM components for blocked builds

Do not implement these prototype-only fields unless the backend is explicitly
extended first:

- reorder point
- days of cover
- burn per day
- supplier lead days
- stock meter max/fill percentages
- production buckets: Now / This week / Next week / Later
- start-by scheduling
- 10-day maturation hold chips
- downstream production tree persistence

## Page Layout

Keep the page compact and shadcn-native.

- Outer shell: `mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-6`.
- Header: title, compact summary, updated time, search, refresh.
- Body: two top-level `Card size="sm"` surfaces.
- Desktop body grid: `lg:grid-cols-[minmax(0,1fr)_420px]`.
- Mobile: cards stack in source order.
- Use `divide-y` lists inside cards; avoid full-width row cards inside cards.
- Keep rows roughly 56-64px high.
- Use `PO` and `MO` badges instead of separate subsection headings.

The header should count action/workflow items, not raw planning rows:

- ready actions = ready PO supplier groups + ready MO rows
- blockers = rows that cannot create a draft now
- affected orders = unique sales-order source refs in the queue
- updated time = `snapshot.generatedAt`

Do not repeat the same counts in multiple subtitles. If a count is in the
header, the card description should say only what the section does or use one
short count.

## Ready Queue

Render one combined `Ready` card.

Sort ready actions by:

1. affected sales-order count descending
2. earliest required date ascending
3. title ascending

Purchase action rows:

- badge: `PO`
- title: supplier name
- meta: `{line count} lines - due {date} - {affected order count} orders`
- primary action: `Create PO`
- drawer opens when the row is clicked
- button posts the group's payloads to
  `POST /api/planning/actions/purchase-orders`

Manufacturing action rows:

- badge: `MO`
- title: item name
- meta: `Build {quantity} {unit} - due {date} - {affected order count} orders`
- primary action: `Create MO`
- drawer opens when the row is clicked
- button posts the action payload to
  `POST /api/planning/actions/manufacturing-order`

Read-only users should see the row and drawer context, but draft creation should
be hidden or replaced with `Read only`. API routes still enforce permissions.

Rows should be keyboard-openable with Enter and Space.

## Needs Attention Queue

Render one `Needs attention` card.

Group blockers by problem type:

- `Materials short`
- `Missing supplier`
- `Choose supplier`
- `Missing price`
- `Missing BOM`
- `BOM cycle`
- `BOM too deep`
- `Draft exists`
- `Plan changed`
- fallback: `Review setup`

Sort blocker groups by:

1. affected sales-order count descending
2. earliest required date ascending
3. label ascending

Each group row should show:

- label
- item count
- earliest due date when present
- affected order count
- up to four preview item names
- outline action button: `Review shortages`, `Assign supplier`, `Add price`,
  `Fix BOM`, or `Review`

The button opens detail; it must not create a draft.

If a make row has short components, do not expose a `Create MO` button anywhere
for that row.

## Drawers

Use `Sheet`, not a custom drawer.

Recommended `SheetContent`:

```tsx
<SheetContent className="w-full gap-0 sm:max-w-lg">
```

Use a wider sheet only when the table content actually needs it. Keep portal
content on semantic `bg-background text-foreground` through the existing
component.

Purchase drawer:

- title: `Create purchase order`
- description: supplier name
- summary: line count, earliest need, affected order count
- primary button: `Create PO`
- line table columns: Item, Need, Needed by, Needed for

Ready manufacturing drawer:

- title: `Create manufacturing order`
- description: item name
- summary: build quantity, needed-by date, affected order count
- primary button: `Create MO`
- needed-for table with sales order refs

Blocked build drawer:

- title: `Cannot build yet`
- description: item name
- summary: needed quantity and due date
- no MO creation button
- short-material table columns: Material, Short, Next step

Grouped blocker drawer:

- title: blocker label
- description: item count and affected order count
- compact list of blocked items with impact and due date
- no draft creation button unless the row is individually actionable and safe

Normal drawers should not expose raw reason-code badges, inventory calculation
math, unrelated source facts, or planning-engine internals.

## Search

Keep one search input in the page header.

Search should match:

- item name
- item SKU
- needed-for summary
- action label
- action summary
- status label
- suggested supplier name
- demand source-ref labels

Search filters visible queues only. Header counts should stay based on the full
queue so the page does not look like the plan changed while searching.

Do not add a filter dropdown unless it has real behavior and tests.

## Visual Details To Preserve

Preserve these designer choices where they fit existing components:

- restrained greyscale surfaces
- dense operational spacing
- short labels
- tabular numeric alignment for quantities and dates
- small `PO` / `MO` badges
- muted meta lines with dot separators
- primary action on the right edge of rows
- hover and focus row states through existing shadcn/Tailwind classes

Use `font-mono tabular-nums` for numeric quantities when it improves scanning.
Use `formatQuantity()` from `lib/format.ts` for quantities. Prefer shared format
helpers over local helper copies when touching date or quantity formatting.

Status color mapping in this repo:

- destructive/error states: `Badge variant="destructive"` or
  `text-destructive`
- neutral/ready states: `Badge variant="secondary"` or `outline`
- avoid adding amber/green one-off classes just because the prototype has them

## Deferred Prototype Features

These are intentionally out of scope for this handoff:

- custom app chrome
- Planning sidebar sub-items
- separate production/replenishment routes
- `Export` and `Auto-plan` buttons
- production bucket cards
- work-order selection checkboxes
- fixed bottom bulk action bar
- `Start`, `Schedule`, `Schedule all`, and overflow menus
- downstream production tree
- stock meter visualization
- days-of-cover sorting
- reorder rules UI
- supplier lead-time display

If any deferred feature becomes required, update `lib/planning/types.ts`,
`lib/planning/service.ts`, API tests, and this document before implementing UI.

## Accessibility

- Clickable rows must be keyboard-openable.
- Row buttons must stop propagation so they do not also open the drawer.
- Search needs `aria-label="Search planning"`.
- Icon-only buttons need screen-reader text.
- Keep visible focus rings from the existing shadcn components.
- Empty queue states should render useful text inside the card body.

## Test Expectations

After implementation changes, run:

```bash
pnpm build
pnpm test
```

If planning stock mutations or inventory projections are touched, refresh the
relevant Playwright test org first, then run:

```bash
pnpm verify:inventory
```

Fast planning coverage should continue to prove:

- the page loads from `/planning`
- ready PO and MO actions are visible when present
- blocked builds do not create MOs
- read-only users cannot create drafts
- drawer detail tables render from real snapshot facts
- draft creation invalidates planning and navigates to the created draft
