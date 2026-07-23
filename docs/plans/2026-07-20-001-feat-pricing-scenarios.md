---
title: Pricing Scenarios - Plan
date: 2026-07-20
type: feat
execution: code
---

# Pricing Scenarios Implementation Plan

> **For agentic workers:** execute task-by-task with scratch-first TDD per `feature-workflow`. Checkboxes track steps.

**Goal:** A real product feature replacing closed PR #761: named pricing scenarios that start from live ERP costs, let the user override assumptions sparsely, show cost + recommended sell price instantly, and record immutable numbered revisions at decision time — gated to Paonia Soil Co. for beta via a billing beta plugin.

**Architecture:** Live baseline + sparse overrides on the card kernel (autosave, idempotent create, 409 auto-rebase); one cost engine (extend `lib/inventory/estimated-cost.ts` with usage-term extraction, no second BOM walker); commit-time immutable revisions modeled like BOM history; entitlement-driven beta gate (no org slugs, no checked-in price book).

**Stack:** existing repo stack. New dep: none (`decimal.js-light` already present).

## Global constraints

- All CLAUDE.md hard rules (DAL only, RLS on new tables, API routes for mutations, HugeIcons, tokens, Playwright-only scratch-first testing).
- Branch: `feat/pricing-scenarios`, stacked on `refactor/bom-batch-readers` (PR #763). Worktree `.worktrees/pricing-scenarios`.
- Nothing in this feature writes ERP items, costs, prices, recipes, inventory, orders, or accounting. Scenario tables + idempotency records only.
- Reference implementation to salvage from: branch `feat/paonia-margin-calculator` @ `d6879e34` (closed #761). Salvage the section-layout ideas; do NOT copy its sales-share math, lifecycle, frozen sources, provenance vocabulary, or Example Construction catalog.
- Deliberately not built (were #761's clunk): frozen source snapshots, explicit Save, conflict fork dialogs, archive/restore, org-slug access checks, hardcoded eligibility (categories/package codes), needs-input provenance taxonomy, direct-link-only routing.

## Calculation contract

Per product unit, `decimal.js-light` over 6-dp strings, display rounds to cents:

```
materials        = Σ leafQtyPerUnit × (override.price ?? baselinePrice)
inboundFreight   = Σ leafQtyPerUnit × (override.inboundFreight ?? 0)
handling         = Σ leafQtyPerUnit × (override.handling ?? 0)
labor            = Σ hoursPerUnit(resource) × (override.rate ?? baselineRate)
directCost       = materials + inboundFreight + handling + labor
costToRecover    = directCost + (override.outboundFreight ?? 0)
overheadDollars  = costToRecover × overheadPct
newCost          = costToRecover + overheadDollars
marginDenominator = 1 − targetProfitPct                      // must be > 0
sellAt           = newCost / marginDenominator
profitDollars    = sellAt × targetProfitPct
currentPrice     = override.currentPrice ?? items.defaultSellingPrice
currentProfit    = currentPrice − newCost
currentMargin    = currentProfit / currentPrice              // null when currentPrice blank/0
```

Rules:
- **Leaf** = any component item with no current BOM revision (materials and BOM-less products). Products with a current BOM always expand recursively; a leaf's baseline price resolves exactly like `estimated-cost.ts` (`currentStockUnitCost ?? purchase-price conversion`).
- Quantity flattening uses the existing float/6-dp discipline (`calculateAverageUnitConsumptionQuantity`, batch ÷ outputQuantity, `fixed_per_mo` hours ÷ (`expectedBatchYield ?? typicalBatchSize ?? standardCostQuantity`)). Same numbers the item card shows.
- Withhold (never zero, never NaN/∞): product result when a cycle or invalid quantity exists in its tree, when a leaf has neither baseline price nor override, or when the margin denominator is invalid (`targetProfitPct ≥ 1`). Overhead and target profit are each validated independently below 100%. Each withheld product carries a named issue rendered next to the result.
- AE anchor: directCost 60, outbound 0, overhead 20%, profit 30% → sellAt $102.86, overhead $12, newCost $72, profit $30.86.

## Data model

Both tables in `lib/db/schema/sales.ts`, `.enableRLS()` + org `pgPolicy` + `FORCE ROW LEVEL SECURITY` in migration, entries in `scripts/verify-db-schema.ts`.

```
sales.pricing_scenarios
  id uuid pk, organization_id, name text,
  doc jsonb $type<PricingScenarioDoc>,
  version integer default 1,
  created_by_user_id/created_at, updated_by_user_id/updated_at,
  deleted_at/deleted_by_user_id (soft delete),
  active partial index (organization_id, updated_at) where deleted_at is null

sales.pricing_scenario_revisions        -- insert-only; no update/delete DAL
  id uuid pk, organization_id,
  scenario_id FK → pricing_scenarios(id),
  revision_number integer, note text null,
  snapshot jsonb $type<PricingScenarioRevisionSnapshot>,
  created_by_user_id, created_at,
  unique (scenario_id, revision_number)
```

`PricingScenarioDoc` (the kernel draft = server doc; sparse — only overridden fields present):

```ts
{
  productIds: string[];                          // uuid, max 200
  materials:      { itemId: string; price: string | null; inboundFreight: string | null; handling: string | null }[];
  resourceRates:  { resourceId: string; rate: string | null }[];
  products:       { itemId: string; currentPrice: string | null; outboundFreight: string | null }[];
  overheadPercent: string | null;                // "35" = 35%
  targetProfitPercent: string | null;
}
```

Collections diff by id (`itemId`/`resourceId`) via kernel `collections` config. Decimal strings validated by the shared numeric grammar (reuse the schema helpers `lib/schemas/*` already use for money fields); arrays enforce unique keys and bounded size (≤ 500 rows each).

`PricingScenarioRevisionSnapshot` = resolved report, display-only, never recomputed:

```ts
{
  calculationVersion: "cost-plus-margin-v1";
  capturedAt: string;                            // server time at commit
  globals: { overheadPercent, targetProfitPercent };
  products: {
    itemId; name; sku;
    materials: { itemId; name; quantityPerUnit; unitPrice; inboundFreight; handling; priceSource: "baseline" | "override"; costPerUnit }[];
    labor:     { resourceId; name; hoursPerUnit; rate; rateSource; costPerUnit }[];
    buckets: { materials; inboundFreight; handling; labor; directCost; costToRecover };
    outboundFreight; currentPrice;
    result: { sellAt; newCost; overheadDollars; profitDollars; currentMargin } | { withheld: true; issues: string[] };
  }[];
}
```

## Beta gate (billing)

- `lib/billing/types.ts`: add `"pricing_scenarios"` to `BILLING_PLUGINS` + label `"Pricing scenarios"`. **No** lookup key, catalog offer, or package membership — not sellable during beta. Add `export const BILLING_BETA_PLUGINS: readonly BillingPlugin[] = ["pricing_scenarios"]`.
- `lib/billing/entitlements.ts` `getFeatureAccessInTx`: immediately after computing `entitled`, insert the deferred beta clause (this is the "one AND-clause" docs/billing.md promised):

```ts
if (BILLING_BETA_PLUGINS.includes(plugin)) {
  return { entitled, locked: !entitled, grandfathered: false, orgName: org.name };
}
```

  Beta lock ignores the enforcement env kill-switch and grandfathering on purpose: an unreleased feature must never fail open to every org. The try/catch fail-open in `assertFeatureAccessInTx` still applies (billing bug ≠ outage).
- Server: every DAL mutation/read for this feature runs `assertFeatureAccessInTx(tx, orgId, "pricing_scenarios", { route })` (locked → existing 402 `FeatureEntitlementError`; nav is hidden so non-entitled users never see the surface).
- Page: `app/(dashboard)/sales/pricing-scenarios/layout.tsx` mirrors `sales/pricing/layout.tsx` — `requireModuleAccess("sales", ...)` + `access.locked → redirect("/sales/orders")` (match the module-role argument `sales/pricing/layout.tsx` uses).
- Nav: `lib/dashboard-navigation.ts` sales items gain `{ title: "Scenarios", href: "/sales/pricing-scenarios", icon: <HugeIcons calculator-ish> }` (and the second registry near line 218 if it lists per-route metadata); `app/(dashboard)/layout.tsx` fetches access for `pricing_scenarios` in the same `Promise.all` and appends `"/sales/pricing-scenarios"` to `hiddenNavHrefs` when locked.
- `docs/billing.md`: replace the "deliberately not built" allowlist bullet with the beta-plugin mechanism; graduation path = remove from `BILLING_BETA_PLUGINS`, add lookup key + catalog offer (or fold under `wholesale_pricing`).
- Post-beta packaging (out of scope): fold into `wholesale_pricing` vs own $99 plugin — user decision later.

## Costing seam (one engine)

In `lib/inventory/estimated-cost.ts` (same file, reusing the private `loadEstimatedCostGraphInTx`):

```ts
export type ProductUsageTerms = {
  materialTerms: { itemId: string; quantityPerUnit: string }[];   // aggregated across the tree by leaf item
  laborTerms: { resourceId: string | null; hoursPerUnit: string; fallbackRatePerHour: string | null }[]; // aggregated by resource
  issues: ("cycle" | "invalid_quantity" | "invalid_batch_denominator" | "missing_component")[];
};
export async function getProductUsageTermsByItemIdInTx(tx: Tx, itemIds: string[]): Promise<Map<string, ProductUsageTerms>>
```

- Extend the graph loader's operation select with `resourceId` (column exists: `lib/db/schema/manufacturing.ts:371`).
- Walk = same recursion/cycle-guard shape as `getEstimatedRecipeCostSummariesByItemIdInTx` (`includeLotCosts: false`), but multiply quantities down the tree instead of costs, and stop at leaves (no current revision).
- `fixed_per_mo` hours divide by the canonical denominator; missing/invalid → `invalid_batch_denominator` issue, no term.
- Operations with null `resourceId` aggregate under `resourceId: null` ("Unassigned") and price via the snapshot rate on the operation row, exposed as `fallbackRatePerHour`.
- Existing exports and their numbers are untouched — build/lint plus fast:inventory/manufacturing prove no regression.

Baseline block (assembled in the DAL for GET detail and commit): distinct leaf items → `{ itemId, name, sku, unitName, baselinePrice }` (resolution identical to `stockUnitCostForMaterial`); resources → `{ resourceId, name, baselineRate }` from `manufacturingResources.loadedCostPerHour`; products → `{ itemId, name, sku, unitName, baselineCurrentPrice: items.defaultSellingPrice }`.

## Pure calc engine

`lib/pricing-scenarios/calculations.ts` — isomorphic (no `server-only`), consumed by both the client (instant recalc via kernel `derive`/memo) and the server (revision commit). Use standard cost-plus-margin arithmetic: overhead marks up `costToRecover`, while target profit is a margin of the selling price. Inputs are `{ baseline, usageTerms, doc }`; output is the per-product `result | withheld` shape used by `PricingScenarioRevisionSnapshot.products[].result`. Snapshots carry the `"cost-plus-margin-v1"` calculation version.

## API + DAL

`lib/schemas/pricing-scenarios.ts` (Zod, shared by routes and kernel), `lib/dal/pricing-scenarios.ts`, `lib/api/clients/pricing-scenarios.ts`, `lib/client/query-keys.ts` additions. All routes use `apiHandler`; create, duplicate, and revision commit carry `Idempotency-Key` through the established ledger helper. Conditional `version` update returns the canonical 409 `{ conflict, current }` envelope (supplier route is the template).

| Route | Behavior |
|---|---|
| `GET  /api/pricing-scenarios` | Active list: id, name, updatedAt/updatedBy, latestRevisionNumber. |
| `POST /api/pricing-scenarios` | Kernel create-as-first-save: name + doc → row; returns detail. |
| `GET  /api/pricing-scenarios/[id]` | `{ scenario: { id, name, doc, version, audit }, baseline, usageTerms, revisions: [{ id, revisionNumber, note, createdBy, createdAt }] }` — live baseline computed per request, `no-store`. |
| `PATCH /api/pricing-scenarios/[id]` | Save name + doc with `expectedVersion`; 409 envelope on stale. |
| `DELETE /api/pricing-scenarios/[id]` | Soft delete (standard entity delete; revisions retained). |
| `POST /api/pricing-scenarios/[id]/duplicate` | Copy name+doc to a new scenario (no revisions carried). |
| `POST /api/pricing-scenarios/[id]/revisions` | Commit: resolve live baseline + saved doc server-side → insert snapshot, `revision_number = max+1`; body `{ note? }`. |
| `GET  /api/pricing-scenarios/[id]/revisions/[revisionId]` | Snapshot detail (read-only render). |

DAL functions: `listPricingScenarios`, `getPricingScenarioDetail`, `createPricingScenario`, `updatePricingScenario` (expectedVersion), `softDeletePricingScenario`, `duplicatePricingScenario`, `commitPricingScenarioRevision`, `getPricingScenarioRevision`. Every one asserts the beta gate first. Commit and detail share one `resolveScenarioInputsInTx(tx, doc)` helper so the page preview and the frozen snapshot can never disagree.

## UI

- `app/(dashboard)/sales/pricing-scenarios/page.tsx` — list page (standard list frame per `docs/design/components.md`): Name, Updated, By, Revisions columns; New scenario → creates draft card route.
- `app/(dashboard)/sales/pricing-scenarios/[id]/page.tsx` + client — a **card page** on `useCardKernel` (customer card `app/(dashboard)/sales/customer-card.tsx` is the template): `schema` = PATCH schema, `collections` = materials/resourceRates/products keyed by item/resource id, `create`/`update` `apiJson` adapters, `readVersion`, `onServerDoc`/`onCreated`, `createGate` = "Add a product to save" while `productIds` is empty. Save pill = standard `CardPage` save state. **No Save button, no nav guards, no conflict dialogs, no library modal.**
- Editor composition: selectable product list with per-product Sell at; a worksheet labelled in the selected product's unit, with material rates per purchase/stock unit, usage, and derived landed cost per product unit; labour rates, hours, and derived cost per product unit; per-product current price and outbound freight; and a sticky results rail for assumptions, cost to recover, Sell at, breakdown, and margin at the current price. The pure engine recalculates on every committed field edit.
- Product picker: searchable combobox listing product-type items by name/SKU; adding/removing updates `productIds` through `update()`.
- Revisions: history list on the card (Rev N · date · note), `Commit revision` card action with a one-field note prompt; selecting a revision opens its snapshot read-only in a dialog with a `Restore to draft` action (client `update()` copying snapshot overrides into the doc). Snapshot material/labour rows store derived `costPerUnit`; schema defaults keep older snapshots without the field readable.
- Duplicate/Delete via `useCardEntityActions`.

## Tasks

### T1. Beta gate
Files: `lib/billing/types.ts`, `lib/billing/entitlements.ts`, `docs/billing.md`.
Steps: scratch spec asserting a non-entitled org gets `locked: true` for `pricing_scenarios` while `lot_tracking` keeps shadow semantics, and an entitled org unlocks → red → implement clause → green → commit.

### T2. Schema + migration
Files: `lib/db/schema/sales.ts`, generated `drizzle/*`, `scripts/verify-db-schema.ts`.
Steps: tables per Data model → `pnpm db:generate` (fresh origin/main base) → patch `FORCE ROW LEVEL SECURITY` + grants exactly as migration 0176 did in #761 → `pnpm drizzle-kit migrate` → verify-db-schema entries → commit.

### T3. Usage terms + baseline
Files: `lib/inventory/estimated-cost.ts`, `lib/dal/pricing-scenarios.ts` (baseline helper only).
Steps: scratch spec seeding nested BOM (unit+batch basis, nested product, fixed_per_mo op, cycle case, missing denominator) asserting exact flattened quantities/hours and issues → red → implement → green; rerun `pnpm test:fast:inventory` + `fast:manufacturing` → commit.

### T4. Calc engine + schemas
Files: `lib/pricing-scenarios/calculations.ts`, `lib/schemas/pricing-scenarios.ts`.
Steps: scratch cases — AE anchor (60→102.86), target profit ≥100% withheld, independent percentage validation, missing baseline withheld, shared-material override propagating to two products, product-specific isolation, blank current price → margin null — red → implement → green → commit.

### T5. DAL + routes
Files: DAL, routes, api client, query keys per API table.
Steps: scratch API story — create → detail (baseline present) → patch (version bump) → stale patch 409 envelope → duplicate → commit revision (number 1, then 2) → mutate ERP cost → old snapshot byte-stable, fresh detail baseline moved → soft delete hides from list, revisions retained → wrong-org 404/402, non-entitled 402 → red → implement → green → commit.

### T6. UI
Files: pages/components per UI section, `lib/dashboard-navigation.ts`, `app/(dashboard)/layout.tsx`, `app/(dashboard)/sales/pricing-scenarios/layout.tsx`.
Steps: scratch UI spec — create from list, add products, edit price → result updates without network, autosave pill, reload restores, commit revision → appears in rail, revision page read-only + restore, nav hidden for non-entitled org → red → implement → green. Then `pnpm sandbox /sales/pricing-scenarios`, screenshot pass per `docs/ui-review-checklist.md` (desktop + 390px), fix, delete scratch shots spec → commit.

### T7. Distill + land
Steps: fold invariants into lanes per `docs/testing.md` (fast: sales seam — scenario save + revision commit + 409; slow: sales operating story extension covering the create→override→commit→ERP-drift→snapshot-stable arc); delete scratch suite; docs sweep (`docs/sales.md` feature section, `docs/billing.md` done in T1, CLAUDE.md doc-map row only if a dedicated doc emerges); Android-impact subagent (must read `~/Projects/erp-android/CLAUDE.md` first); `pnpm review /sales/pricing-scenarios --slow sales`; `no-mistakes axi run --yes --intent "Pricing scenarios v1: live-baseline card-kernel scenarios with commit-time revisions, beta-gated to Paonia"`; labels `ci:slow:sales` (or `ci:slow:all` if shared schema/DAL churn demands, per docs/testing.md) then `ci:ready`.

## Post-deploy (separate task, not in PR)

Prod script run via `!`: append `pricing_scenarios` to Paonia org `entitlements`; create scenario "Example Construction baseline" — productIds = Paonia's bag/tote products, overrides mapped **by SKU** from `d6879e34:lib/margin-calculator/assumptions.server.ts` values (material/freight/handling per SKU, overhead 35, target 35), then commit Rev 1 via the API so the seed goes through the same validation. Verify in prod UI with the user before telling Kate/Robbie.

## Self-review notes

- #761 parity check: shared-across-products override semantics preserved (overrides key by itemId/resourceId, not per product); product-specific price/freight preserved (products array); cost-plus-margin deliberately replaces the sales-share formula; decimal-string discipline stays at the calc layer while extraction matches app-canonical quantities.
- Deviations from #761 are all deliberate and listed under Global constraints.
- Open items intentionally deferred: revision-to-revision diff view; packaging/pricing of the plugin; folding under wholesale_pricing; operator docs page.
