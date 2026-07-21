# Billing: trial, Core capacity, usage buckets, and plugin entitlements

How the free trial, Core plan capacity, and paid plugins switch on and off per
org. The architecture is deliberately minimal — four pieces, each of which
breaks something nameable if removed, and nothing more:

1. **One entitlement state.** `organization.entitlements` (jsonb plugin list).
   The Stripe subscription webhook writes commercial entitlements; beta
   entitlements are granted manually. Nothing else in the system may answer
   "does this org have X."
2. **One decision.** `getFeatureAccessInTx` — a fresh in-transaction read of
   that column folded with the rollout env (below). The UI wrapper
   `getFeatureAccessForCurrentOrg` is the same decision. Never cache it,
   never re-derive it client-side: a customer who just checked out must see
   the product notice immediately.
3. **A handful of server gates.** One `assertFeatureAccessInTx` line inside
   the DAL transaction where each paid action commits (~10 lines across all
   plugins, ever — see the inventory below). These are what make a downgrade
   hold against un-updated mobile apps, direct API calls, integrations, and
   any future agent write path: every client funnels through the DAL, so
   billing is solved once, not once per client. Each call is a single
   primary-key read on the already-open transaction — no measurable overhead.
4. **The UI hides what the org can't use.** No locked states, no upgrade
   tooltips, no upsell chrome. Trial/default workflows are complete and
   designed, not a paid product with holes. Upsell surfaces, if any, are a
   separate future product decision — never baked into feature gating.

The plugin registry — ids, labels, Stripe lookup keys — lives in
`lib/billing/types.ts` and is the only shared code a new plugin touches. The
sellable catalog (`BILLING_CATALOG`: display names, blurbs, prices) lives in
the same file. `STRIPE_BILLING_CATALOG` expands that display catalog with
annual variants for recurring add-ons/extra locations, including graduated
extra-location tiers that match the public calculator, and
`scripts/stripe-create-catalog.ts` creates those Stripe prices keyed by lookup
key — no price IDs are stored anywhere. The script batches lookup-key checks at
Stripe's 10-key request limit, so the full Core/location/add-on catalog can be
created idempotently as it grows.

Core plan capacity lives on `organization` next to subscription state:

- `plan = trial | free | core`
- `trialEndsAt`
- `billingInterval = monthly | annual`
- `salesOrderBand = starter | growth | pro | scale`
- `locationCapacity`
- `billingAddons` (purchased add-on lookup keys, not expanded plugins)
- `currentPeriodStart` / `currentPeriodEnd`

The public calculator starts Core at $299/month. Stripe subscription items own
the selected Core base band, billing interval, extra-location quantity, and
add-ons. Add-on lookup keys are stored as purchased products in `billingAddons`;
plugin entitlements are derived from those lookup keys for gates.

Core self-serve catalog:

| Sales-order band | Monthly | Annual displayed monthly equivalent | Monthly shipped-order threshold |
| --- | ---: | ---: | --- |
| Starter | $299 | $249 | up to 100 |
| Growth | $399 | $333 | up to 250 |
| Pro | $549 | $458 | up to 1,000 |
| Scale | sales-assisted | sales-assisted | 1,000+ |

Core includes one active location. Each additional location is a Stripe quantity
on `extra_location`; the graduated unit price starts at $40/month, drops by $2
per additional location, and floors at $24/month. Annual recurring add-ons and
extra locations use the annual lookup-key suffix and charge ten months for the
year. Scale is intentionally rejected from self-serve checkout.

Plan intents at public/app boundaries are structured selections: `mode=core`,
`band`, `interval`, `locationCapacity`, and `addonLookupKeys`. Legacy
`plan=core` and lookup-key links normalize into Core starter monthly with one
included location, preserving old links without allowing package-only checkout.
Trial is the default public signup path; `free` remains only for
legacy/internal compatibility.

Sales-order volume is app-owned usage, not a hard operational cap. When a sales
order first ships/delivers or a partially shipped order is short-closed, the app
records an idempotent `billingUsageEvents` row in the calendar-month usage
window. If monthly usage
crosses a bucket threshold, `billingPeriodAdjustments` records the full-period
bucket delta and the worker creates an idempotent Stripe invoice item plus an
immediate automatic invoice. The invoice is created as a subscription-scoped
draft, the adjustment item is attached to that invoice, then the invoice is
finalized for automatic collection. Monthly
subscriptions use the monthly usage window as the adjustment period; annual
subscriptions use the Stripe annual period so the same band delta is charged at
most once per annual term. Shipment schedules the worker immediately;
`/api/internal/billing-adjustments` also sweeps pending adjustments on a cron so
a failed final shipment retry is not lost. That internal route bypasses the
session-cookie proxy gate and must enforce its own bearer token from
`BILLING_ADJUSTMENTS_SECRET` or `CRON_SECRET`. Adjustment rows back off between
retries and move to `failed` after repeated Stripe errors instead of retrying
forever. The recurring Core subscription item is not automatically
price-swapped for bucket crossings. Additional locations remain hard capacity
because creating a new active site is a persistent expansion of the workspace.

Expired trials are the one sales-order capacity gate: after the launch instant,
non-grandfathered orgs must move to Core before creating more sales orders.
Core order volume itself is never blocked; bucket crossings queue adjustment
charges instead.

**Deliberately not built** (add only when the trigger fires): a gate
declaration registry and CI gate-coverage guard (trigger: the inventory table
below outgrows grep), page-level UI forks (trigger: a plugin that genuinely
restructures a surface — so far section composition has sufficed), entitlement
caching (trigger: measured latency, which one PK read in an existing
transaction will not produce).

## Beta plugins

`BILLING_BETA_PLUGINS` in `lib/billing/types.ts` is the per-org allowlist the
paragraph above used to defer. A plugin listed there is **locked unless the
org holds the entitlement** — the decision ignores shadow mode, the
enforcement kill-switch, and grandfathering, because an unreleased feature
must never fail open to every org. Beta plugins have a registry id and label
but no lookup key, catalog offer, or package membership: they are not
sellable, and the entitlement is granted manually (a data change on
`organization.entitlements`), not by the Stripe webhook. UI surfaces hide via
the same `locked` flag as any plugin (nav `hiddenNavHrefs` + layout redirect).
Graduation = remove the id from `BILLING_BETA_PLUGINS` and give it a lookup
key + catalog offer (or fold it into an existing plugin's gate call). Current
beta plugins: `pricing_scenarios` (Paonia Soil Co. beta).

## The trial-default rule

**The trial/default state is a closed system. Gates guard transitions out of
it; any transition back toward the default is always free.** This is what makes
downgrade safe: data stays intact, paid workflows lock, and nothing an org did
while entitled can strand it. Every gate must define its default and leave the
path back to it ungated.

Existing examples:

| Gated (entering paid state) | Free (returning to / staying in default) |
| --- | --- |
| Disposition to `blocked`/`rejected`, scrap | `release` back to `available` |
| Recording a NEW stocktake found lot | Re-counting/deleting existing found lots; resolving a found lot to an existing lot number |
| New lot via stock adjustment | Adjusting existing lots |
| New lot from a positive aggregate count at stocktake completion | Zero/negative aggregate counts; untracked items |
| Non-FIFO ingredient `lotStrategy` | Reverting to `fifo`; execution always picks FIFO |
| MO output into a blocked disposition (complete/outputs/batch paths) | Completing or recording output as `available` |
| Creating a new batch-mode MO; switching a recipe or an MO onto batch basis | In-flight batch MOs always execute and complete; editing already-batch MOs and recipes; reverting a recipe to unit; discrete MOs at any quantity |
| Creating new CRM contacts/activities/projects | Editing/deleting existing CRM records; customer CRUD and order snapshots |
| Creating/updating pricing schedules; schedule-based price resolution (computation gate) | Manual per-line price and discount overrides; existing lines keep their pricing snapshots |
| Adding a second location, transfers | Everything at the single default location; deleting extra locations |

A gate that locks an exit (e.g. gating `release`) traps customer data behind a
paywall — treat that as a bug. Watch for sibling write paths that reach the
same state: the stocktake found-lot gate also required gating new-lot creation
via stock adjustments/reconciliations AND stocktake completion (a positive
aggregate count on a tracked item with no lot lines makes the kernel generate
a lot) — each unguarded door was a bypass. Likewise the batch gate needed the
MO-update and BOM-revision transitions, and the blocked-disposition gate needed
all three MO output paths (complete, outputs, batch complete) — sweep every
caller of the state, not just the obvious create.

Downgrade data semantics: toggling never deletes, migrates, or rewrites data.
Kernel data (lots, dispositions, ledger history) stays visible always because
free workflows touch it. Plugin-only data (e.g. CRM activities, pricing
schedules) hides with its UI surface — intact, and reappears on re-subscribe.
Paid *computations* stop applying on downgrade (e.g. wholesale price
resolution must fall back to standard pricing, or downgraded orgs keep the
paid behavior).

## Adding a gate

1. **Server (authoritative):** call
   `assertFeatureAccessInTx(tx, orgId, "<plugin>", { route })` inside the DAL
   mutation transaction where the paid action commits. It shadow-logs or
   throws a 402 `FeatureEntitlementError` and emits a founder alert for real
   enforced denials. Fails open on errors (Sentry
   `billing_feature_entitlement`) — a billing bug must never block
   operations; don't "fix" that.
   - **Prefer unconditional gates.** When building a NEW endpoint, factor the
     paid operation into its own route/DAL function so the whole operation
     gates. A payload-conditional gate (see `lib/dal/stocktakes.ts`,
     `lib/inventory/queries/item-lots.ts`) is the documented exception for
     legacy surfaces that mix free and paid semantics in one mutation.
   - Computation variant: when the paid feature is a behavior rather than a
     mutation (wholesale price resolution), the gate is a decision read at
     the computation site — paid behavior applies only when entitled.
2. **UI (hide, don't lock):** fetch `getFeatureAccessForCurrentOrg(plugin)`
   in the page's existing `Promise.all` and thread `access.locked` down as a
   prop. When `locked`, the paid affordance **does not render** — shadow mode
   stays visually unchanged because `locked` is always false in shadow.
   Hiding comes in exactly two shapes; plugin awareness lives only at these
   boundaries, never inside components:
   - **Leaf** — a control, menu action, field, or column doesn't render
     (`LotDispositionActions` offers only the free actions and renders no
     menu when nothing free remains; the stocktake found-lot button hides).
   - **Section** — a page composes sections; a plugin's section simply isn't
     in the composition and the layout flexes. A module is the largest
     section: its nav entry and route don't exist for the org.
3. **Test:** scratch-first against an enforcing dev server — set
   `BILLING_ENFORCED_PLUGINS=<plugin>` and
   `BILLING_ENFORCEMENT_LAUNCH_AT=2020-01-01T00:00:00Z` in the WORKTREE
   `.env.local` (never the repo root) and restart. Drive 402-unentitled /
   200-entitled / downgrade-keeps-data / escape-hatches-free / re-grant, then
   delete the scratch suite. The fast lane runs in shadow, so route-level
   enforcement is scratch-only; the in-process decision lifecycle is pinned in
   `test/e2e/fast/billing-entitlements.spec.ts`.
4. **Mobile:** the Android app mirrors the hide rule — gated affordances hide
   for unentitled orgs, and any gated route the app calls returns 402 the day
   the plugin enters `BILLING_ENFORCED_PLUGINS` (the 402 is a backstop for
   stale app versions, never the primary UX). Run the mobile-impact subagent
   (repo rule) and record the pre-enforcement app work on ERP-197.

## Enforcement env (deploy-level)

- `BILLING_ENTITLEMENTS_ENFORCED=0` — global kill switch; anything else means on.
- `BILLING_ENFORCED_PLUGINS` — comma-separated plugins that 402; everything
  else shadow-logs `[billing-shadow-denial]` JSON (org, plugin, route) to
  server logs. Unset by default: all plugins shadow.
- `BILLING_ENFORCEMENT_LAUNCH_AT` — orgs created before this instant are
  grandfathered (never blocked, still shadow-logged). Unset ⇒ every org is
  exempt. **Global, not per-plugin**: an org created after the first launch is
  non-grandfathered for all later plugins too — always ship a plugin's gates
  well before adding it to `BILLING_ENFORCED_PLUGINS`.

These are launch scaffolding, not permanent architecture — they retire after
enforcement is stable, leaving entitlements as the only input.

Launch runbook: gates ship in shadow → watch shadow-denial volume in Vercel
logs (re-counts and escape hatches must NOT appear; they pollute the go/no-go
data) → set `BILLING_ENFORCEMENT_LAUNCH_AT` → add the plugin to
`BILLING_ENFORCED_PLUGINS` once mobile handles its surfaces.

Dev note: `locked` is always false in shadow, so hidden states only appear
with the enforcement vars set on the dev server (see step 3). Without them
"my affordance never hides" is expected, not a bug.

## Gate inventory

| Plugin | Status | Gates |
| --- | --- | --- |
| `lot_tracking` | shipped (ERP-192/195) | disposition to non-available, new found lots, new lots via adjustment/reconciliation/stocktake completion, non-FIFO lotStrategy, MO output into a blocked disposition (complete/outputs/batch paths; `outputDispositionLocked` on the MO detail drives the dialog hide) |
| `batch_production` | shipped (ERP-195) | new batch-mode MO creation (`insertManufacturingOrderInTx`, covers direct/duplicate/from-sales-order) plus batch-entering transitions on MO update and BOM revisions; in-flight batch MOs always execute; UI hides the batch recipe basis and batch products in MO pickers |
| `crm` | shipped (ERP-195) | new contacts/activities/projects (`lib/sales/queries/crm.ts` creates); edits/deletes of existing records free; UI hides the Contacts and Activity sections and the customers-list Next action column/filter |
| `wholesale_pricing` | shipped (ERP-189/195) | `createPricingSchedule` + `updatePricingSchedule`; resolution computation gate in `getPricingScheduleLookupForProductsInTx`; UI hides the Pricing nav item and redirects `/sales/pricing` |
| `multi_location` | shipped (ERP-190/195) | location create/transfers (server, ERP-190); UI hides the add-location row |
| `pricing_scenarios` | beta (Paonia Soil Co.) | every scenario read and mutation in `lib/dal/pricing-scenarios.ts`; UI hides the Scenarios nav item and redirects `/sales/pricing-scenarios` |

## Capacity inventory

| Capacity | Source | Gate |
| --- | --- | --- |
| Sales-order bucket usage | `billingUsageEvents` shipped/delivered count for the current calendar-month usage period vs `organization.salesOrderBand` plus period adjustments | `recordSalesOrderShippedUsageInTx` during final shipment or short-close records usage and queues bucket adjustment charges; Core sales workflows are not blocked by volume |
| Trial sales-order creation | `organization.plan`, effective `trialEndsAt`, and `BILLING_ENFORCEMENT_LAUNCH_AT` | `assertSalesOrderCapacityInTx` inside `createSalesOrder`; active trials and Core orgs continue, expired non-grandfathered trials receive 402 before new order creation |
| Locations | `inventory.locations` active count vs `organization.locationCapacity` | `assertLocationCapacityInTx` inside `createInventoryLocation`; the `multi_location` entitlement unlocks the workflow surface, but paid `locationCapacity` controls the active-location count |
