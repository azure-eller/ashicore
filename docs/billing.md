# Billing: plugin entitlements and feature gates

How paid plugins gate workflows, and how to add a gate without breaking the
on/off (entitle → downgrade → re-grant) lifecycle. The plugin registry —
ids, labels, upgrade copy, Stripe lookup keys — lives in `lib/billing/types.ts`
and is the only shared code a new plugin touches. The Stripe subscription
webhook is the single writer of `organization.entitlements`.

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
| Non-FIFO ingredient `lotStrategy` | Reverting to `fifo`; execution always picks FIFO |

A gate that locks an exit (e.g. gating `release`) traps customer data behind a
paywall — treat that as a bug. Watch for sibling write paths that reach the
same state: the stocktake found-lot gate also required gating new-lot creation
via stock adjustments/reconciliations, or it was a bypass.

## Adding a gate

1. **Server (authoritative):** call
   `assertFeatureAccessInTx(tx, orgId, "<plugin>", { route })` inside the DAL
   mutation transaction, conditioned on the payload so only the paid
   transition gates (see `lib/dal/stocktakes.ts`, `lib/dal/stock-adjustments.ts`,
   `lib/inventory/queries/item-lots.ts`). It shadow-logs or throws a 402
   `FeatureEntitlementError` with `featureUpgradeMessage(plugin)`. Fails open
   on errors (Sentry `billing_feature_entitlement`) — a billing bug must never
   block operations; don't "fix" that.
   - Read-path variant (blessed for module-level plugins like planning): one
     assert at the top of the module's service entry covers every consumer
     (web, Android, agent). Don't scatter per-action gates when one read-path
     gate is the real boundary.
2. **UI mirror (optional, per page):** fetch
   `getFeatureAccessForCurrentOrg(plugin)` in the page's existing
   `Promise.all` and thread `access.locked` down as a prop. Render disabled
   controls with the shared upgrade tooltip ONLY when `locked` — shadow mode
   must stay visually unchanged. `locked` comes from the same pure decision
   (`getFeatureAccessInTx`) the server gate uses; never re-derive gate logic
   client-side. Per-action gates mirror per-action: offer the free actions,
   disable-with-tooltip only when nothing free remains
   (`LotDispositionActions`). Whole-module plugins branch at the top of the
   page (`if (access.locked) return <upsell/>`) instead of threading.
3. **Test:** scratch-first against an enforcing dev server — set
   `BILLING_ENFORCED_PLUGINS=<plugin>` and
   `BILLING_ENFORCEMENT_LAUNCH_AT=2020-01-01T00:00:00Z` in the WORKTREE
   `.env.local` (never the repo root) and restart. Drive 402-unentitled /
   200-entitled / downgrade-keeps-data / escape-hatches-free / re-grant, then
   delete the scratch suite. The fast lane runs in shadow, so route-level
   enforcement is scratch-only; the in-process decision lifecycle is pinned in
   `test/e2e/fast/billing-entitlements.spec.ts`.
4. **Mobile:** any gated route the Android app calls returns 402 the day the
   plugin enters `BILLING_ENFORCED_PLUGINS`. Run the mobile-impact subagent
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

Launch runbook: gates ship in shadow → watch shadow-denial volume in Vercel
logs (re-counts and escape hatches must NOT appear; they pollute the go/no-go
data) → set `BILLING_ENFORCEMENT_LAUNCH_AT` → add the plugin to
`BILLING_ENFORCED_PLUGINS` once mobile handles 402s on its surfaces.

Dev note: `locked` is always false in shadow, so locked UI states only render
with the enforcement vars set on the dev server (see step 3). Without them
"my disabled state never shows" is expected, not a bug.

## Gate inventory

| Plugin | Status | Gates |
| --- | --- | --- |
| `lot_tracking` | shipped (ERP-192) | disposition to non-available, new found lots, new lots via adjustment/reconciliation, non-FIFO lotStrategy |
| `batch_production` | ERP-193 | batch-mode MO creation (planned); `outputDisposition` belongs here |
| `planning` | ERP-194 | read-path gate at the planning snapshot service (planned) |
| `crm` | ERP-195 | activity create/edit; contacts/customers stay free (planned) |
| `wholesale_pricing` | partial (ERP-189) | `createPricingSchedule`; **`updatePricingSchedule` still ungated, no UI mirror** — close in ERP-195/196 |
| `multi_location` | ERP-190 | second location / transfers (planned); single default location free |
