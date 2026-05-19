---
read_when: planning v1.1 work on the variant-first card UI, or before deleting legacy item-form/edit routes
---

# Variant-first card UI — cleanup roadmap

ERP-157 ships the Katana-style product/material card UI in parallel with Codex's
backend (ERP-156, PR #374). To keep the UI pass non-destructive while Codex's
DTOs stabilize, several legacy routes/files remain in place and several
features are explicitly stubbed. This doc tracks what to clean up after the new
card is the default.

## Route flip (do this first)

The card is currently opt-in via `?view=card` on `/inventory/products/:itemId`
and `/inventory/materials/:itemId`. When Codex confirms `GET /api/item-cards/:itemId`
is stable on Paonia seed data, flip the gate in two files:

- `app/(dashboard)/inventory/products/[id]/page.tsx` — render `<ProductCard>` by default; remove the `if (view === "card")` branch and the fallthrough to `ItemDetail`.
- `app/(dashboard)/inventory/materials/[id]/page.tsx` — same, for `<MaterialCard>`.

Tag the PR `ci:slow:inventory` so the slow inventory stories rerun with the new default.

## Legacy routes / files (delete after the card is stable)

After 2 weeks of card-only usage with no error reports, delete:

| File | Why it can go |
|------|---------------|
| `app/(dashboard)/inventory/products/[id]/edit/` | superseded by inline editing on the card |
| `app/(dashboard)/inventory/products/[id]/variants/new/` | superseded by Variant Configuration dialog |
| `app/(dashboard)/inventory/materials/[id]/edit/` | superseded |
| `app/(dashboard)/inventory/materials/[id]/variants/new/` | superseded |
| `app/(dashboard)/inventory/item-form/index.tsx` (and `dialogs/`, `fields/`) | only used by the `/edit` routes |
| `app/(dashboard)/inventory/variant-form.tsx` | only used by `/variants/new` |
| `app/(dashboard)/inventory/item-detail.tsx` | only reachable through the legacy fallback in page.tsx |

Note: the Recipe and Operations tabs on the new card currently link out to
`/inventory/products/:variantId/edit` for inline editing. Before deleting the
edit route, restore inline editing on the card (see "Inline Recipe / Operations
editor" below).

## Schema cleanup (Codex owns; track here)

After Codex confirms backfill is complete and reads have switched off the old
columns, the follow-up migration drops:

- `items.isMaster`, `items.parentId`, `items.variantAxes`, `items.variantAttrs`
- `items_products_only_variants` / `items_products_only_masters` / `items_variants_not_masters` constraints
- the legacy `formatVariantDisplay(masterName, attrs, axes)` signature in `lib/format.ts` — switch all call sites to `formatVariantDisplayFromFamily` first

## Test cleanup

- `test/e2e/fast/variants.spec.ts` exercises the master/variant-axes flow. Once the new card is the default, retire that file and let `test/e2e/fast/variants-card.spec.ts` cover the variant lifecycle.
- The slow inventory stories that grep `isMaster`/`variantAxes` should be migrated to the new model in the same PR.

## DTO extensions Codex still owes

The current `ItemCardDto` shape is missing fields the variant table wants to
display. The UI either places "—" placeholders or omits the column today; each
item below shows where the gap surfaces.

| Field | Where the UI needs it | Today's behavior |
|-------|----------------------|------------------|
| `variants[].defaultSellingPrice` | product variant table (sales price column) | column omitted |
| `variants[].defaultPurchasePrice` | material supply variants table (Default purchase price) | placeholder `—` |
| `variants[].currentStockUnitCost` | variant table (cost reference) | column omitted |
| `variants[].safetyStock` | product/material variant table | column omitted |
| `variants[].onHand` (sum of lot balances) | "In stock" column | column omitted |
| `variants[].ingredientsCost` (computed) | product variant table | column omitted |
| `variants[].operationsCost` (computed) | product variant table | column omitted |
| `family.defaultSupplierId` in `itemCardUpdateSchema` | material Supply details default supplier | input disabled |

The PATCH side already accepts the per-variant pricing fields — only the read
DTO needs widening. The supply-default fields need both schema and write
support.

## Backend endpoints still pending

The UI ships typed clients for these — each renders disabled with a "Pending
backend" tooltip until 200s come back. See `lib/api/clients/item-cards.ts`.

- `POST /api/items/:variantId/stock-adjustments` — Add Initial Stock dialog
- `POST /api/items/:variantId/bom/copy-to` and `/copy-from` — Recipe tab "Copy to / Copy from" dialogs
- `POST /api/items/:variantId/operations/copy-to` and `/copy-from` — Operations tab "Copy to / Copy from" dialogs
- `GET /api/locations` — Add Initial Stock dialog location picker (currently a disabled `<Input>`)
- **Sequence-backed internal barcode generation** — v1 ships a client-side `getMaxNumericInternalBarcode()` that walks `/api/items` to find the org's max and increments from there per variant. Race window is small for single-user dev but real under concurrent edits. v1.1: add a Postgres sequence `inventory.internal_barcode_seq` starting at 10000, expose via `POST /api/items/:variantId/generate-internal-barcode` (or a bulk variant), and replace the client walk.

## Backend-vs-design contradictions to resolve

These are places where the Calm Matrix design assumes a backend behavior that
Codex's actual implementation doesn't provide. Each one needs a decision before
the route flip:

- **Locked variant config when assignments exist.** `lib/inventory/item-cards.ts:489-491` throws `"Variant options with existing assignments cannot be replaced."` But the design spec §11 says *"Existing variants with matching keys keep their data"* — implying additive option/value edits should be allowed after generation. UI currently shows a "Configuration is locked once variants exist" banner that reflects backend behavior. Pick one: support additive edits in the backend, or accept the locked-config UX and update the design doc.
- **Per-variant `sortOrder`** for drag-to-reorder (design §6.2, §7.2, §8.1). Codex's `ItemCardVariantDto` has no sortOrder; backend doesn't persist row order. Pending design decision: add `sortOrder` to the variant DTO + PATCH schema, or drop drag-reorder from v1.1 scope.
- **Family-level Sell/Buy/Make/Kit-bundle toggles** (design §6.1). Codex's `itemFamilies` schema and `itemCardUpdateSchema` don't have these. v1 hides the Usability row entirely (per decision in PR review). v1.1: pick whether to lift `sellable` from items to family + add `buyable`/`makeable`/`kitBundle` columns, or keep Sell as a per-variant column in the variant table.
- **Variant tracking ("Track by serial number or in batches")** — design wants a success-soft panel + link. No tracking subsystem exists. v1 hides the strip entirely (per decision); v1.1 either ships a real tracking model or leaves this out permanently.
- **Tab caption "Ingredients · $X avg"** (design §5). `CardTabs` accepts a `caption` prop but no caller computes the avg yet because the DTO doesn't expose ingredients cost per variant. Wire up once the DTO is extended.

## UI gaps to close in v1.1

**Shared `CardTable` extraction** — every editable table on the card pages
(variant table, BOM table, operations table, supply variants table, used-in-BOMs
table) currently re-implements the same shadcn-Table + inline-edit chrome with
the `.it-tbl` styling pasted in per-component. v1.1 should pull this into a
single `components/card-page/card-table.tsx` with a column-config API
(`columns: Column<T>[]`, `rows: T[]`, cell kinds: text/number/select/action).
Decision was explicit during v1: AG Grid's existing wrappers don't support
inline editing well, and the design spec uses a CSS shell pattern (`.it-tbl`),
not AG Grid. Reaching for AG Grid here would add complexity without benefit.

Inline editing for these surfaces still routes the user to the legacy `/edit`
page:

- **Recipe tab**: extract the existing BOM editor (`app/(dashboard)/inventory/bom-editor.tsx`) into the card. The editor takes a react-hook-form `Control`; the card tab needs to own a per-active-variant form context and call `PUT /api/items/:variantId` on submit.
- **Operations tab**: extract `OPERATION_COST_GRID_COLUMNS` + `OperationCostEditor` from `app/(dashboard)/inventory/item-form/index.tsx` (currently a local function). Same write path as Recipe (operations live on the BOM revision).
- **Lots / Movements tabs**: not built in v1. Reuse the existing shadcn tables from `item-detail.tsx:833-1222`. Add an Active Variant selector and a filter by selected variant.

Other deferred items:

- **Variant detail drawer (eye icon).** Design §6.2 + §7.2 has a trailing `eye` icon on the variant SKU and BOM Item cells that opens a side drawer with detail. No drawer exists in v1. Defer until there's a user need.
- **Overflow menu actions Duplicate / Archive / Export / View activity** (design §4). v1 ships only Delete. Add the others once corresponding backend endpoints/flows exist.
- **Delete-variant confirm: "this affects N open orders"** count (design §14). Codex's `DELETE /api/items/:id` returns 400 with the conflict reason; UI surfaces that. A pre-count requires a separate read endpoint. Defer.
- **"+ Add row" below the variant table** (design §6.2). New variants need option-value assignments, which is what the Variant Configuration dialog does. A bare Add row that produced a variant with NULL option values would violate the schema. Defer — and confirm the design intent.
- **Animated dot on the Saving… pill** (design §4). Static currently. Cosmetic; trivial fix when worth doing.
- **Sell / Buy / Make** family-level toggles — Codex's schema only carries `items.sellable` per-variant. Either lift sellable to family-level + cascade, or fold Sell into the variant table as a per-row checkbox. Current UI hides the Usability row entirely (per decision in PR review).
- **Re-enabling disabled options/values** — backend disables on delete; UI shows muted strikethrough on existing variants but has no affordance to re-enable. Add an admin-only "Show disabled" toggle to the Variant Configuration dialog.
- **Bulk-remove material from BOMs** — Used in BOMs tab has a single column for v1; bulk action needs a backend endpoint + UI selection.
- **Unit-of-measure change** — backend's `itemCardUpdateSchema` omits `unitDefinitionId`. UI renders the unit as disabled with explanatory copy. If unit edits are needed, Codex must opt the field in.
- **Custom field collection**, **Material / Product tracking** — Katana shows these as placeholders. UI mirrors with stubs; defer until the underlying data model lands.

## Where the cleanup work should NOT happen

These are intentionally not in scope:

- Don't touch sales / MO / purchasing / stocktake pickers in this cleanup pass. They use `displayName` from `getItems()` and continue to work through the new card route via `items.id`.
- Don't migrate `formatVariantDisplay(masterName, attrs, axes)` callers piecemeal. Wait until Codex's read DTO is updated, then sweep all call sites in one PR.
