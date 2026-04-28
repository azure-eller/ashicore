# Handoff: Production Planning & Replenishment

## Overview

This is the design for the **Planning** section of an inventory/manufacturing app for a soil-blend manufacturer. It replaces a free-form, unprioritized "what should I make / what should I order?" workflow with two focused, decision-oriented screens:

1. **Production** — A prioritized work queue showing what to manufacture next, derived from open sales orders and the BOM (bill of materials). Sub-assemblies expand to show every downstream sales order they feed.
2. **Replenishment** — A reorder-point list for raw materials, bulk-orderable into supplier-grouped POs.

The user is a small-team operations lead (1–10 people) running a custom soil-blend business. Customers are primarily nurseries and garden centers placing recurring orders for finished blends in totes and bags. Some products require sub-assemblies (e.g. 1-yard totes feed cubic-yard bags), and certain blends need their inputs to age 10+ days before the next stage can run.

## About the Design Files

The files in this bundle are **design references created in HTML/JSX** — prototypes showing intended look and behavior, not production code to copy directly. They use React 18 via inline Babel, vanilla CSS, and mock data.

The task is to **recreate these designs in the target codebase's existing environment** using its established patterns and libraries (component framework, design tokens, data layer, routing). If no target codebase exists yet, choose a stack appropriate to the project (Next.js + Tailwind + shadcn/ui is a natural fit since this design borrows heavily from that vocabulary).

Do not ship the HTML files as-is. The CSS uses a shadcn-style HSL token system that should map cleanly onto an existing shadcn theme; component structure should map onto your real component library.

## Fidelity

**High-fidelity.** Colors, typography, spacing, weights, and interactions are all final. Recreate pixel-perfectly using your codebase's primitives.

The data is mocked but the data shapes (suppliers, materials, work orders, sales orders, BOM) reflect what the real backend should expose.

---

## Design System

Stack-friendly: this is a shadcn/ui-style system. If the target codebase already uses shadcn, most tokens will already exist.

### Color tokens (HSL, defined in `:root`)

```css
--background: 0 0% 100%;
--foreground: 0 0% 9%;
--muted: 0 0% 96.1%;
--muted-foreground: 0 0% 45.1%;
--border: 0 0% 89.8%;
--border-strong: 0 0% 83%;
--input: 0 0% 89.8%;
--ring: 0 0% 9%;
--primary: 0 0% 9%;          /* near-black */
--primary-foreground: 0 0% 98%;
--secondary: 0 0% 96.1%;
--secondary-foreground: 0 0% 9%;
--accent: 0 0% 96.1%;
--destructive: 0 72% 41%;     /* red */
--destructive-soft: 0 80% 96%;
--warn: 32 95% 44%;           /* amber */
--warn-soft: 38 92% 95%;
--ok: 142 71% 35%;            /* green */
--ok-soft: 142 50% 95%;
--radius: 0.5rem;
```

Use these via `hsl(var(--token))`.

### Typography

- **Sans:** Geist (`'Geist', ui-sans-serif, system-ui, …`). Loaded via Google Fonts in `Planning Page.html`.
- **Mono:** Geist Mono — used everywhere for numbers (`.mono.tabnum` utility class). Always use `font-variant-numeric: tabular-nums` on numeric columns.
- **Body:** 14px / 1.5
- **Page title:** 22px, weight 600, letter-spacing -0.01em
- **Section title:** 14px, weight 600
- **Table header:** 12px, weight 500, uppercase-ish (sentence case actually — see source), color `--muted-foreground`
- **KPI value:** 22px, weight 600, letter-spacing -0.02em, tabular-nums
- **Status chip / badge:** 11.5px, weight 500
- **Small meta:** 10.5–11px, color `--muted-foreground`

### Component primitives

These are all in `styles.css` — most map 1:1 to shadcn:

- **`.btn`** — base button. Variants: `.btn-primary`, `.btn-secondary`, `.btn-outline`, `.btn-ghost`, `.btn-destructive`. Sizes: `.btn-sm`, `.btn-xs`. Icon-only: add `.btn-icon`.
- **`.input`** — single-line text input.
- **`.checkbox`** — custom checkbox (24×24 hit, 14×14 visual).
- **`.card`** — surface with 1px border, 10px radius.
- **`.badge` / `.status-chip`** — small inline labels with `.order-now`, `.order-soon`, `.ok`, etc. modifiers. Each chip has a 6×6 dot and a colored text/bg pairing.
- **`.tabs` / `.tab`** — segmented pill (background `--muted`, active state has white background + 1px shadow).
- **`.tbl.tbl-compact`** — compact table. 8px header padding, 7px body padding, 1px `--border` row dividers, `--muted/0.5` hover row.
- **`.kpi-strip` / `.kpi`** — 4-column metric strip across the top of the page.
- **`.bulk-bar`** — fixed-bottom selection bar (dark surface, white text, 12px gap rules).

---

## App Shell

```
┌─────────┬──────────────────────────────────────────────┐
│         │  Topbar (52px)                               │
│ Sidebar ├──────────────────────────────────────────────┤
│ (220px) │  Content (24px padding)                      │
│         │    PageHeader                                │
│         │    PrimaryTabs                               │
│         │    [Filter row]                              │
│         │    KPI strip (Production only)               │
│         │    Main view                                 │
│         │    BulkBar (when selection > 0)              │
└─────────┴──────────────────────────────────────────────┘
```

### Sidebar (`chrome.jsx`)

Fixed 220px, light-grey background (`hsl(0 0% 99%)`), 1px right border. Sections:

1. **Brand mark** — 28×28 black squircle with monogram, brand name beside.
2. **Navigation** — 5 sections (Dashboard, Sales, **Planning** [active], Inventory, Reports). Each item: 30px height, 8px horizontal padding, 6px gap, 13px text. Active item has `--muted` background and `--foreground` color.
3. **Sub-items** under "Planning": Production, Replenishment.

### Topbar (`chrome.jsx`)

52px height, 1px bottom border, 24px horizontal padding. Contains:

- Breadcrumbs: `Planning › <current view>` — `--muted-foreground` color, 13px, with `›` separator in `--border-strong`.
- Right-aligned: 14×14 user avatar circle.

### PageHeader

Title + subtitle (varies by tab) + right-aligned action buttons (Export ghost-outline, Auto-plan primary).

---

## Screen 1: Production

**URL/route:** `/planning/production` (default tab)

**Subtitle:** "What you need to make next, ordered by what your sales orders demand."

### Layout (top-to-bottom)

1. **PrimaryTabs** — Production / Replenishment segmented control.
2. **Filter row** — right-aligned: Search input (240px, with leading search icon, 30px left padding), Filter dropdown button.
3. **KPI strip** — 4 columns, 12px gap, 20px bottom margin. Each KPI: card with 1px border, 8px radius, 12×14px padding.
   - **Open work orders** — total count, with sub-text like "across X products".
   - **Required this week** — count + sub-text.
   - **Blocked / waiting** — count, red color if > 0.
   - **On-time risk** — count of WOs with insufficient lead time.
4. **Section header** — "Work queue" + small sub-text.
5. **Buckets** — 4 buckets, top-down: **Now** / **This week** / **Next week** / **Later**. Each is a labeled section containing a card-list of work orders.

### Bucket layout

Each bucket has:
- A small label header (12px, uppercase-ish, weight 500, `--muted-foreground` color, with a count chip).
- A vertical stack of work-order cards, separated by 1px dividers.

### Work Order Card (`production-queue.jsx` or `production-order.jsx`)

This is the core component. Card contents:

```
┌─────────────────────────────────────────────────────────┐
│ ☐  [Qty • Unit] Product name [Sub-assembly tag]         │
│    Required by Apr 12 · Inputs in stock                 │
│    Serves SO-3041 Verdant Garden Co.                    │
│    [Feeds 3 downstream uses ▾]   [Start] [⋯]            │
└─────────────────────────────────────────────────────────┘
```

Specifically:
- **Checkbox** at left for bulk-selection.
- **Quantity + unit** in a small mono-tabnum block (e.g. "18 totes"). Slightly larger than body, weight 500.
- **Product name** — 14px, weight 500. Wraps cleanly; the `Sub-assembly` tag flows next to it inline.
- **Sub-assembly tag** — a `.tag-soft` (small grey 18px-tall pill, 6px horizontal padding, 11px font, 3px radius). Variants:
  - **Sub-assembly** — neutral grey. Indicates this WO produces output that feeds another WO.
- **Meta line** — `Required by <date>` + a separator dot + status text. Status texts include:
  - `Inputs in stock` — green dot
  - `Waiting on RAW-XYZ` — amber dot
  - `No upstream MO required` — neutral
  - `Sold direct (no downstream MO)` — neutral
  - `Earliest start so downstream MOs can run on time` — amber, only on critical-path sub-assemblies
- **Serves SO-XXXX Customer Name** — links the WO to its driving sales order(s). For sub-assemblies feeding multiple SOs, this row instead shows a **"Feeds N downstream uses ▾"** toggle button.
- **Action cluster (right)**: `Start` outline button + a `⋯` ghost icon button.

### Downstream Tree (sub-assembly cards)

When a sub-assembly card has multiple downstream uses, the "Feeds N downstream uses ▾" button toggles open a small tree under the card body. Layout:

```
│
├── 18 totes  →  SO-3038 Highland Nursery · due May 5     [Final stage]
│                requires 10+ day hold
│
├── 12 totes  →  SO-3029 Verdant Garden Co. · due May 17  [Feeds another MO]
│                requires 10+ day hold
│
└── 6 totes   →  SO-3052 Coastal Greens · due May 22      [Final stage]
```

- A thin vertical guide line on the left (1px, `--border` color), 28px from the card's left edge.
- Horizontal branch ticks (8px) into each leaf.
- Leaves sorted by due date ascending.
- Each leaf shows: qty + unit, →, SO number + customer + due date, and a tag.
- **Tag variants** (downstream relationship):
  - **Final stage** — small green-tinted pill. Means: this sub-assembly is sold directly to the customer at this stage; no further MO downstream.
  - **Feeds another MO** — small grey-ringed pill. Means: this sub-assembly itself feeds another MO before reaching the customer (chain continues).
- **Constraint chip** (only on "Feeds another MO" leaves): small amber `requires 10+ day hold` chip. Has a tooltip explaining the BOM rule (the downstream consumer requires its input to mature ≥10 days before consumption).
- The toggle button on the parent flips its chevron when open and the open state should persist while the user is on the page.

### Empty / edge states

- Empty bucket: don't render the bucket section at all.
- Card with no downstream tree: hide the toggle row entirely.

---

## Screen 2: Replenishment

**URL/route:** `/planning/replenishment`

**Subtitle:** "Raw materials approaching reorder. Bulk-order to keep production stocked."

### Layout (top-to-bottom)

1. **PrimaryTabs** — same as Production.
2. **Stat strip** — 4 KPIs (`.stat-strip`):
   - **Order now** — count, in destructive red.
   - **Order soon** — count.
   - **Materials tracked** — total + "across N suppliers".
   - **Shortest cover** — e.g. "7d" + the material name as sub-text.
3. **Filter bar** — left: search input (280px, with icon); a `.tabs` segmented control (All / Order now / Soon / Stocked); right: sort button + reorder-rules button.
4. **Materials table** (`.card` containing `.tbl.tbl-compact`).
5. **Bulk bar** (when materials are selected) — fixed bottom-center, dark surface, with `Create N PO(s)` primary button (count = number of distinct suppliers in the selection).

### Materials table columns (left → right)

| Column | Width | Content |
|---|---|---|
| Checkbox | 36px | Bulk-select |
| Material | flex | `<ItemCell>`: name (13px, weight 500) over SKU (11px, `--muted-foreground`, mono) |
| Status | — | `.status-chip` with leading 6×6 dot. Three states: **Order now** (red), **Order soon** (amber), **Stocked** (green) |
| On hand vs reorder | 170px | Stock meter (see below) |
| Days of cover | num | e.g. `7d`, mono-tabnum, color-coded: red < 14d, amber < 21d, otherwise neutral. Weight 500 if red. |
| Supplier | — | Supplier name (12.5px) over `Lead Nd` lead-time (11px, `--muted-foreground`) |
| Suggested | num | Reorder qty + unit (11.5px grey for unit). `—` for stocked items. |
| Action | actions col | `Order` outline-xs for non-stocked, `Adjust` ghost-xs for stocked. |

### Stock meter

Tiny inline visual showing on-hand level relative to the reorder point:

```
On hand vs reorder
┌─────────────────────────┐
│██████│ ▏                │   ← bar fill = on-hand%, tick = reorder point
└─────────────────────────┘
   8 pallets   reorder at 12
```

- 150px wide wrapper, vertical stack with 4px gap.
- **Track**: 6px tall, `--muted` background, 3px radius.
- **Fill**: same height, fills width = `min(100, (onHand / max) * 100)%`. Color follows the row's status:
  - `low` (Order now): `hsl(var(--destructive))`
  - `warn` (Order soon): `hsl(var(--warn))`
  - `ok` (Stocked): `hsl(142 50% 45%)`
- **Marker**: 1.5px wide vertical line at `(reorderAt / max) * 100%`, extending 3px above and below the track. Color `hsl(0 0% 30%)`.
- **Foot row**: 10.5px text, space-between. Left: `<b>{onHand}</b> {unit}` in mono-tabnum. Right: `reorder at {reorderAt}` in `--muted-foreground`.

Where `max = Math.max(onHand, reorderAt * 2)` — this ensures the reorder tick lands at or right of center for healthy items, left of center for short items.

### Bulk bar behavior

When the user selects rows, a dark bar appears fixed at the bottom-center of the viewport:

- Shows: `<N> materials selected · <S> supplier(s)`.
- `Clear` ghost button.
- Primary action: `Create <S> PO(s)` — splits selection into one PO per distinct supplier.

---

## Interactions & Behavior

### Production tab
- **Tabs (Production / Replenishment)**: switch the entire content area; preserves bucket scroll.
- **Sub-assembly tree toggle**: clicks expand/collapse the downstream tree. State should persist while on the page (a `Map<workOrderId, boolean>` is fine).
- **Card checkbox**: bulk-select multiple WOs; the bulk bar should let the user "Start N work orders" or "Reschedule".
- **Start** button: opens a confirmation modal (not in this design — note for later).
- **⋯ menu**: edit, reschedule, cancel, view BOM (not in this design).

### Replenishment tab
- **Status filter tabs**: All / Order now / Soon / Stocked. Filters the table.
- **Row checkbox**: selecting any row reveals the bulk bar.
- **Order button (per row)**: opens a draft PO for that one material.
- **Create N POs (bulk bar)**: splits selection by `material.supplier`, opens N draft POs.
- **Sort by Days of cover** (default): ascending — most urgent at top.

### Hover / focus states
- Table rows: `--muted/0.5` background.
- Buttons: standard shadcn pattern (background shifts to `--muted` on outline/ghost, deeper on primary).
- Selected row: `hsl(0 0% 96%)` background.
- All clickable elements should have visible focus rings (`outline: 2px solid hsl(var(--ring))` or shadcn's standard pattern).

### Animations
Minimal. Only:
- Width transitions on stock-meter fills (`transition: width 0.2s`).
- Default browser transitions on button hover.

---

## State Management

The design assumes the following data is fetched from the backend per page load:

### For Production
```ts
type WorkOrder = {
  id: string;
  qty: number;
  unit: string;
  productName: string;
  productSku: string;
  isSubAssembly: boolean;
  requiredBy: Date;
  status: 'inputs-in-stock' | 'waiting-on-material' | 'no-upstream' | 'sold-direct' | 'earliest-start';
  waitingOnMaterial?: { sku: string; name: string };
  bucket: 'now' | 'this-week' | 'next-week' | 'later';
  servesSalesOrders: { id: string; customer: string }[];   // direct uses
  downstream?: {                                            // sub-assemblies only
    qty: number;
    unit: string;
    salesOrderId: string;
    customer: string;
    dueDate: Date;
    relationship: 'final-stage' | 'feeds-another-mo';
    requiresMaturationHold: boolean;                        // true → show amber chip
  }[];
};
```

### For Replenishment
```ts
type Supplier = {
  id: string;
  name: string;
  leadDays: number;
};

type Material = {
  id: string;
  name: string;
  sku: string;
  unit: string;            // 'pallet' | 'yd³' | 'bale' | 'super sack' | 'roll' | 'bag' | 'tote'
  supplierId: string;
  onHand: number;
  reorderAt: number;
  reorderQty: number;
  daysCover: number;
  burnPerDay: number;
  status: 'order-now' | 'order-soon' | 'ok';
};
```

### Local UI state
- `selectedWorkOrders: Set<string>`
- `selectedMaterials: Set<string>`
- `expandedTrees: Set<string>` (sub-assembly WO ids whose downstream is open)
- `materialFilter: 'all' | 'order-now' | 'order-soon' | 'ok'`
- `productionFilter: { search: string }`

---

## Design Tokens Summary

(See full list above. Quick reference for a developer wiring up Tailwind/shadcn.)

| Token | Value |
|---|---|
| Background | `hsl(0 0% 100%)` |
| Foreground | `hsl(0 0% 9%)` |
| Muted | `hsl(0 0% 96.1%)` |
| Muted-foreground | `hsl(0 0% 45.1%)` |
| Border | `hsl(0 0% 89.8%)` |
| Border-strong | `hsl(0 0% 83%)` |
| Primary | `hsl(0 0% 9%)` |
| Destructive | `hsl(0 72% 41%)` |
| Warn | `hsl(32 95% 44%)` |
| OK | `hsl(142 71% 35%)` |
| Radius (default) | `0.5rem` |
| Radius (card) | `10px` |
| Radius (badge / chip) | `4px` / `3px` |
| Body font size | 14px |
| Table cell height | ~32px (compact) |
| Sidebar width | 220px |
| Topbar height | 52px |
| Content padding | 24px |
| KPI grid gap | 12px |
| Section bottom margin | 20–24px |

---

## Assets

- **Fonts:** Geist Sans + Geist Mono (Google Fonts). Self-host or use the existing brand font system if present.
- **Icons:** Custom inline SVG components in `icons.jsx` — names: `search`, `filter`, `download`, `sparkles`, `chevronDown`, `chevronRight`, `alert`, `info`, `boxes`, `calendar`, `settings`, `sortAsc`, `shoppingCart`, `play`, `more`, etc. In the target codebase, **substitute with Lucide React** (or whatever icon library is in use) — every icon used here has a 1:1 Lucide equivalent.
- **Brand mark:** A simple monogram squircle in the sidebar — placeholder. Replace with the real product logo.
- **No raster images** are used in the design.

---

## Files in this bundle

| File | What's in it |
|---|---|
| `Planning Page.html` | App shell — loads React/Babel CDN, fonts, all JSX modules |
| `app.jsx` | Top-level App component, tab state, page header |
| `chrome.jsx` | Sidebar, Topbar, PageHeader, PrimaryTabs |
| `production-queue.jsx` | Production work-queue buckets + work-order cards |
| `production-order.jsx` | (If split) WorkOrderCard component + downstream tree |
| `replenishment.jsx` | Replenishment table, stat strip, stock meter, bulk bar |
| `data.jsx` | Mock data — SUPPLIERS, MATERIALS, WORK_ORDERS, SALES_ORDERS, BOM |
| `icons.jsx` | Inline SVG icon components |
| `styles.css` | All tokens + component CSS |

The HTML bootstraps React via inline Babel. In your real codebase you'll replace this entirely — these files exist only as a fidelity reference.

---

## Implementation notes for the developer

1. **Start with the design tokens.** If your codebase uses shadcn already, half your work is done — these tokens line up. Add the `--warn` / `--ok` / `--border-strong` tokens if missing.
2. **Build the work-order card first.** It's the most complex composite. Get the inline-flowing tag, the meta-line dot separators, and the action cluster right.
3. **The downstream tree is the highest-detail piece.** Pay attention to the vertical guide line, branch ticks, leaf alignment, and the two relationship-tag colors. The amber `requires 10+ day hold` chip should only appear on `feeds-another-mo` leaves.
4. **The stock meter is small but specific.** The `max = Math.max(onHand, reorderAt * 2)` rule is what makes the reorder tick land in a sensible position across very different scales (8 pallets vs. 8400 bags).
5. **Bulk-bar PO splitting** — the count in `Create N PO(s)` is `new Set(selectedMaterials.map(m => m.supplierId)).size`. Recompute on every selection change.
6. **Numeric tabular alignment** matters a lot in this design. Every numeric cell, every quantity, every "Nd" cover indicator should be tabular-nums + mono. Use the `font-variant-numeric: tabular-nums` declaration globally on `.mono.tabnum`.
7. **Prefer real components over hand-rolled markup** where possible — your shadcn `<Table>`, `<Badge>`, `<Button>`, `<Tabs>`, `<Checkbox>` will all map directly.
