# Billing: plugin entitlements and feature gates

How paid plugins switch on and off per org. The architecture is deliberately
minimal — four pieces, each of which breaks something nameable if removed,
and nothing more:

1. **One state.** `organization.entitlements` (jsonb plugin list). The Stripe
   subscription webhook is its only writer. Nothing else in the system may
   answer "does this org have X."
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
   tooltips, no upsell chrome. The free tier is a complete, designed product,
   not a paid product with holes. Upsell surfaces, if any, are a separate
   future product decision — never baked into feature gating.

The plugin registry — ids, labels, Stripe lookup keys — lives in
`lib/billing/types.ts` and is the only shared code a new plugin touches.

**Deliberately not built** (add only when the trigger fires): a gate
declaration registry and CI gate-coverage guard (trigger: the inventory table
below outgrows grep), page-level UI forks (trigger: a plugin that genuinely
restructures a surface — so far section composition has sufficed), entitlement
caching (trigger: measured latency, which one PK read in an existing
transaction will not produce), org-level feature preferences (trigger: a real
customer ask; the decision function gains one AND-clause).

## The free-default rule

**The free tier is a closed system. Gates guard transitions out of it; any
transition back toward the free default is always free.** This is what makes
downgrade safe: data stays intact, paid workflows lock, and nothing an org did
while entitled can strand it. Every gate must define its free default and leave
the path back to it ungated.

Existing examples (all `lot_tracking`):

| Gated (entering paid state) | Free (returning to / staying in default) |
| --- | --- |
| Disposition to `blocked`/`rejected`, scrap | `release` back to `available` |
| Recording a NEW stocktake found lot | Re-counting/deleting existing found lots |
| New lot via stock adjustment | Adjusting existing lots |
| New lot from a positive aggregate count at stocktake completion | Zero/negative aggregate counts; untracked items |
| Non-FIFO ingredient `lotStrategy` | Reverting to `fifo`; execution always picks FIFO |

A gate that locks an exit (e.g. gating `release`) traps customer data behind a
paywall — treat that as a bug. Watch for sibling write paths that reach the
same state: the stocktake found-lot gate also required gating new-lot creation
via stock adjustments/reconciliations AND stocktake completion (a positive
aggregate count on a tracked item with no lot lines makes the kernel generate
a lot) — each unguarded door was a bypass.

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
   throws a 402 `FeatureEntitlementError`. Fails open on errors (Sentry
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
| `lot_tracking` | shipped (ERP-192) | disposition to non-available, new found lots, new lots via adjustment/reconciliation/stocktake completion, non-FIFO lotStrategy |
| `batch_production` | ERP-193 | batch-mode MO creation (planned); `outputDisposition` belongs here |
| `crm` | ERP-195 | activity create/edit; customer records stay free (planned) |
| `wholesale_pricing` | partial (ERP-189) | `createPricingSchedule`; **`updatePricingSchedule` and price-resolution computation still ungated, no UI hiding** — close in ERP-195/196 |
| `multi_location` | ERP-190 | second location / transfers (planned); single default location free |
