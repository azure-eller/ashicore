---
read_when:
  - Preparing a production deployment
  - Configuring auth, invite, or password-reset delivery
  - Setting up error reporting or investigating production failures
  - Verifying Vercel-side protections before launch
---

# Production Operations

## Canonical App URL

All auth-facing emails must use one configured canonical app URL.

- Prefer `BETTER_AUTH_URL`
- Fall back to `NEXT_PUBLIC_APP_URL`
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

Required env vars:

- `RESEND_API_KEY`
- `EMAIL_FROM`

In local and CI environments without Resend configured, the app writes transactional emails to `.tmp/email-outbox/` instead of sending them.

Playwright also forces outbox mode with `.tmp/email-outbox-only` during `test/global-setup.ts`. This avoids linked-worktree cases where the dev server inherited repo-root Resend vars before the test process started.

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

Use request IDs in API error responses and logs so failures can be matched across user reports, logs, and Sentry events.

## Inventory Reconciliation Cron

Inventory integrity now has a scheduled production backstop.

Route:

- `GET /api/internal/inventory-reconciliation`

Auth:

- set `CRON_SECRET` on Vercel to let the built-in cron call the route with `Authorization: Bearer <CRON_SECRET>`
- or set `INVENTORY_RECONCILIATION_SECRET` and have an external scheduler call the same route with the same bearer token

Schedule:

- `vercel.json` runs the route hourly with `0 * * * *`

Behavior:

- the route walks every organization in `system.organization`
- for each org, it recomputes item, lot, reservation, and expected projections from `inventory.inventory_events`
- if any org has drift, the route throws
- `apiHandler` sends the exception to Sentry and returns a non-2xx response so the cron run is visibly failed

Use this as a production backstop, not as the primary correctness check. The primary workflow for code changes is still Playwright plus `pnpm verify:inventory` in the worktree.
