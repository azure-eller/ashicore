---
read_when:
  - Preparing a production deployment
  - Configuring auth, invite, or password-reset delivery
  - Setting up error reporting or investigating production failures
  - Verifying Vercel-side protections before launch
---

# Production Operations

## Canonical App URL

All auth-facing emails use one canonical app URL.

- Prefer `BETTER_AUTH_URL`
- Fall back to `NEXT_PUBLIC_APP_URL`
- Default production canonical URL: `https://ashicore.app`
- On Vercel preview deploys, `VERCEL_BRANCH_URL` then `VERCEL_URL` are acceptable non-request fallbacks when the canonical URL vars are unset
- Never derive invite or auth email links from `request.url`

This avoids wrong-host links when the inbound host header is not the public app domain.

## Vercel Preview Auth

For preview deployments that should support real sign-in flows:

- set `BETTER_AUTH_SECRET` in the `Preview` environment
- set `BETTER_AUTH_ALLOWED_HOSTS=*.vercel.app` in the `Preview` environment
- prefer a stable preview fallback URL in `BETTER_AUTH_URL` or `NEXT_PUBLIC_APP_URL`
- branch deploys may still use `VERCEL_BRANCH_URL` / `VERCEL_URL` automatically if the canonical URL vars are missing

## Email Delivery

Production requires real email delivery for:

- team invitations
- password reset
- email change verification
- founder alerts for acquisition and billing events

Required env vars:

- `RESEND_API_KEY`

Default sender:

- `Ashicore <noreply@ashicore.app>`

Set `EMAIL_FROM` only when overriding that sender.

In local and CI environments without Resend configured, the app writes transactional emails to `.tmp/email-outbox/` instead of sending them.

Playwright also forces outbox mode with `.tmp/email-outbox-only` during `test/global-setup.ts`. This avoids linked-worktree cases where the dev server inherited repo-root Resend vars before the test process started.

Founder alerts are optional but required before actively marketing paid signup:

- set `ASHICORE_ALERT_EMAILS` in the ERP Vercel production environment
- use a comma-separated list when multiple recipients should be notified
- alert delivery failures are logged and must not block signup, checkout, or Stripe webhooks

## Billing, Trial, And Paid Signup

Production paid checkout and bucket-adjustment retries require live-mode
configuration on the ERP Vercel project:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_CATALOG_READY=1`
- `STRIPE_LIVE_MODE=1`
- `BILLING_ADJUSTMENTS_SECRET` or `CRON_SECRET`

Stripe setup checklist:

1. Create the live catalog prices: `STRIPE_SECRET_KEY=sk_live_... pnpm tsx scripts/stripe-create-catalog.ts` (idempotent; keys every price by lookup key — no price IDs to record; batches lookup-key discovery at Stripe's 10-key limit). This includes Core monthly and annual sales-order bands, graduated monthly and annual extra-location tiers, and monthly/annual plugin/package add-ons.
2. Create a live webhook endpoint for `https://ashicore.app/api/stripe/webhook`.
3. Subscribe the webhook to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.deleted`
5. Set `STRIPE_WEBHOOK_SECRET` from the live endpoint signing secret.
6. Set `STRIPE_SECRET_KEY` to the live restricted or secret key used by the ERP app.
7. Set `STRIPE_LIVE_MODE=1`.
8. Set `STRIPE_CATALOG_READY=1` only after the live catalog script succeeds.
9. Redeploy the ERP project after env changes.

Verification before marketing paid signup:

- Vercel production env lists all Stripe and cron vars above.
- `STRIPE_CORE_PRICE_ID` is ignored by the app and should not be used for launch verification.
- `/settings/billing` shows trial status, Core upgrade, usage counts, and plugin catalog for a trial organization.
- A live-mode Core checkout reaches Stripe Checkout from the deployed ERP app.
- Returning from checkout leaves the org on `plan=core` with the purchased sales-order band, billing interval, location capacity, purchased add-on lookup keys, and derived plugin entitlements after the webhook is processed.
- Final shipping and short-closing partially shipped orders record current-period billing usage. Crossing a Core bucket queues one pending `billingPeriodAdjustments` row and creates one idempotent Stripe invoice item on a subscription-scoped automatic invoice for the full-period bucket delta; sales shipment and short-close must still succeed if Stripe is temporarily unavailable.
- Bucket adjustment charges queue only for orgs created on or after `BILLING_ENFORCEMENT_LAUNCH_AT`; before launch, usage is recorded but adjustment charging stays in shadow.
- `/api/internal/billing-adjustments` is configured in Vercel cron and authorized by `BILLING_ADJUSTMENTS_SECRET` or `CRON_SECRET`, so pending bucket adjustments retry with backoff even if the customer does not ship another order that period; repeated Stripe failures mark the row `failed`.
- Vercel Runtime Logs show no `Stripe billing is not configured.` errors.
- Founder alert email arrives for checkout start and subscription activation when `ASHICORE_ALERT_EMAILS` is set.

Use the launch checker to verify required production env names and public-site
analytics markup:

```bash
pnpm launch:check -- \
  --vercel-project-id prj_M6zvmzh8NgNQPvKbM4zQWTmTFgfy \
  --vercel-team-id team_2KdVcduwgDF7TpfBP5bKnhZo \
  --vercel-project-name erp \
  --marketing-url https://ashicore.app
```

## Xero Token Key Rotation

Use `pnpm rotate:xero-token-key -- --environment production --apply` for
operator-run Xero token encryption key rotation. The deployed app must not
manage its own master token-encryption secret.

Deployment sequence:

1. Script updates Vercel production env with old + new keys and the new active
   `XERO_TOKEN_ENCRYPTION_KEY_ID`.
2. Redeploy/restart production so runtime can decrypt with both keys.
3. Script rotates `integrations.connections` accounting token rows and verifies
   all rows decrypt under the active key.
4. Script requires `retire <oldKeyId>` before removing the old key.
5. Script removes the legacy `XERO_TOKEN_ENCRYPTION_KEY` fallback.
6. Redeploy/restart production again so runtime no longer has the old key.

See `docs/xero-security-evidence.md` for the evidence/runbook details.

## Vercel Auth Protection Checklist

For launch, auth abuse protection is infra-owned rather than app-owned. Before launch, verify Vercel-side controls cover:

- sign in
- sign up
- password reset request
- password reset completion
- invitation acceptance

Record in the launch checklist:

- where the Vercel protection is configured
- who owns verifying it before launch
- how it was tested against a deployed environment

If auth abuse appears later, or if fine-grained cooldown behavior is needed, revisit app-owned shared throttling.

## Sentry Setup

Follow the Next.js SDK shape from the Sentry skill:

- `instrumentation-client.ts` for browser errors, tracing, and session replay
- `sentry.server.config.ts` for Node.js server runtime
- `sentry.edge.config.ts` for edge runtime
- `instrumentation.ts` for runtime registration and `onRequestError`
- `app/error.tsx` and `app/global-error.tsx` for App Router boundaries

Recommended enabled features in this repo:

- error monitoring across browser, server, and edge runtimes
- tracing in all three runtimes
- session replay in the browser with default masking/blocking enabled
- source maps and release tagging when Sentry build env vars are configured

Do not capture by default:

- passwords
- reset tokens
- invite tokens
- raw request bodies
- customer notes/comments unless intentionally scrubbed

Keep server-side `includeLocalVariables` off on Vercel and other deployed environments. Sentry's local-variable integration opens the Node inspector, which is useful for local debugging but can add major cold-start latency in production-like runtimes. If you need it, gate it behind a local-only env flag such as `SENTRY_INCLUDE_LOCAL_VARIABLES=1`.

Use request IDs in API error responses and logs so failures can be matched across user reports, logs, and Sentry events.

## Cold-start Debugging

The app now stamps a request ID on both HTML and API responses:

- `x-request-id`
- `x-erp-request-id`

Use that ID to correlate the browser request with Vercel Runtime Logs.

Perf logs are emitted as `[perf]` JSON lines. Key events:

- `rsc.root_layout.complete`: HTML request finished; `sinceProxyMs` is the end-to-end server wall time from proxy entry to response completion
- `auth.get_session`: Better Auth session lookup
- `auth.load_membership`: active-org membership lookup
- `db.set_org_context`: RLS org context setup
- landing-page data loads:
  - `inventory.get_items`
  - `inventory.get_stocktakes`
  - `inventory.get_ledger`
  - `inventory.get_ledger_actor_options`
  - `inventory.get_ledger_item_options`
  - `sales.get_orders`
  - `sales.get_customers`
  - `sales.get_pricing_schedules`
  - `purchasing.get_orders`
  - `purchasing.get_suppliers`
  - `manufacturing.get_orders`
- inventory list substeps:
  - `inventory.get_items.base_query`
  - `inventory.get_items.current_bom_set`
  - `inventory.get_items.used_in_counts`
  - `inventory.get_items.revenue_30d`
  - `inventory.get_items.estimated_recipe_costs`
  - `inventory.get_items.variant_option_values`
  - `inventory.get_items.map_sort`

Temporarily set this sample rate to `1` while debugging slow route navigation:

- `NEXT_PUBLIC_NAVIGATION_TELEMETRY_SAMPLE_RATE`

API routes also emit:

- `Server-Timing`
- `x-erp-handler-ms`
- `x-erp-db-query-ms`
- `x-erp-db-query-count`
- `x-erp-db-connect-ms`
- `x-erp-db-connect-count`
- `x-erp-process-uptime-ms`

How to use it in production:

1. Load the slow page in the browser and copy `x-erp-request-id` from the response headers.
2. Search that request ID in Vercel Runtime Logs.
3. Check Vercel’s function start type for that request: `Cold`, `Hot`, or `Hot (prewarmed)`.
4. Compare `sinceProxyMs` on `rsc.root_layout.complete` with the step logs:
   If `auth.get_session` or `db.set_org_context` is large, the bottleneck is auth/DB startup.
   If those are small but `rsc.root_layout.complete` is large, the delay is later in page rendering or page-specific data work.
5. For API-heavy flows, use `Server-Timing` and the `x-erp-db-*` headers to separate handler time from DB connect/query time.

## Inventory Reconciliation Cron

Inventory integrity now has a scheduled production backstop.

Route:

- `GET /api/internal/inventory-reconciliation`

Auth:

- set `CRON_SECRET` on Vercel to let the built-in cron call the route with `Authorization: Bearer <CRON_SECRET>`
- or set `INVENTORY_RECONCILIATION_SECRET` and have an external scheduler call the same route with the same bearer token

Schedule:

- `vercel.json` runs the route daily with `0 0 * * *`

Behavior:

- the route walks every organization in `system.organization`
- for each org, it compares item balances to current lot balances plus active demand/expected summaries
- it also reports raw ledger drift for lot, demand, and expected projections as diagnostics
- if any org has drift, the route throws
- `apiHandler` sends the exception to Sentry and returns a non-2xx response so the cron run is visibly failed

Use this as a production backstop, not as the primary correctness check. The primary workflow for code changes is still Playwright plus `pnpm verify:inventory` in the worktree.

Manual repair:

- inspect first with `pnpm diff:projections -- --org-id <org-id> [--item-id <id> ...]`
- dry-run the repair with `pnpm repair:projections -- --org-id <org-id> [--item-id <id> ...]`
- apply with `pnpm repair:projections -- --org-id <org-id> --apply [--item-id <id> ...]`
- apply raw stock-ledger lot repair only when required with `pnpm repair:projections -- --org-id <org-id> --apply --repair-stock-ledger [--item-id <id> ...]`

The default repair command rebuilds item balances from current lot balances plus active demand/expected summaries, and keeps legacy lot quantities aligned to current lot balances. It does not mutate demand or expected summary rows; those remain kernel-event repairs because they are business-reference projections. It also does not rewrite lot balances from raw stock events unless `--repair-stock-ledger` is provided. Use that flag only after confirming raw stock events should overwrite current lot rows.

For Paonia planning-reference drift, preview and apply the compensating event repair with:

```bash
tsx scripts/repair-planning-references.ts --org-slug paonia-soil-company
tsx scripts/repair-planning-references.ts --org-slug paonia-soil-company --apply
```

## Billing Adjustments Cron

Bucket adjustment billing has a scheduled production retry path.

Route:

- `GET /api/internal/billing-adjustments`

Auth:

- the route bypasses the Better Auth session proxy gate, so the handler must validate its own bearer token
- set `CRON_SECRET` on Vercel to let the built-in cron call the route with `Authorization: Bearer <CRON_SECRET>`
- or set `BILLING_ADJUSTMENTS_SECRET` and have an external scheduler call the same route with the same bearer token

Schedule:

- `vercel.json` runs the route every 30 minutes with `*/30 * * * *`

Behavior:

- the route finds organizations with due `pending` bucket adjustments
- each org is processed under its RLS context
- Stripe invoices are created as subscription-scoped drafts, then the adjustment invoice item is attached and the invoice is finalized for automatic collection
- failed Stripe send attempts back off, then become `failed` after repeated attempts
