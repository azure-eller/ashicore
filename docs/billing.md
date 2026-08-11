# Billing: Free, Pro, SKU capacity, and beta access

Ashicore has two commercial plans:

| Plan | Price | Capacity |
| --- | ---: | --- |
| Free | $0 forever | Every released feature; 30 active SKUs after a 15-day setup grace period |
| Pro | $199/month | Every released feature; unlimited active SKUs |

Users, integrations, locations, orders, lots, manufacturing, CRM, pricing, and
API access are not commercially gated. Pricing Scenarios remains a separate
organization beta and is not part of the commercial plan decision.

## SKU definition and enforcement

One active `inventory.items` row is one SKU. Materials, products, and concrete
variants each count once, including rows whose display SKU field is blank.
Soft-deleted rows do not count.

`organization.skuLimitStartsAt` is the instant when Free creation capacity
begins. New organizations receive a database default 15 days after creation, so
Better Auth, normal signup, and passwordless Xero signup cannot drift. Upgrading,
canceling, or resubscribing never resets the date.

`assertSkuCapacityInTx(tx, orgId, requestedCount)` is the only capacity
decision. It locks the organization row, counts active items, and admits the
entire requested increment only when one of these is true:

- the effective plan is Pro (`core` remains a transition alias)
- the setup grace has not ended
- `active + requested <= 30`
- the temporary rollout kill switch `BILLING_SKU_LIMIT_ENFORCED=0` is set

The assertion runs inside the item-creation transaction and idempotency boundary.
It covers item cards, legacy item creation, clone, single/bulk variants,
onboarding imports, accounting imports, and Xero purchasing imports. Bulk work
is atomic: it never creates a partial catalog.

An over-limit Free organization keeps every existing record and workflow. Only
new SKU capacity returns HTTP 402. Editing and soft-deleting remain available;
deleting an item frees a slot.

## Stripe projection

The sellable catalog contains one lookup key: `pro_monthly`, $199/month. Checkout
is created inside the authenticated app and stamps `organizationId` onto the
Stripe customer, Checkout Session, and subscription. Do not use a generic Stripe
Payment Link because it cannot guarantee organization mapping.

Active, trialing, paused, past-due, and unpaid recognized subscriptions project
to Pro while Stripe dunning runs. A completed cancellation or deleted
subscription projects to active Free, clears the current subscription ID, keeps
all data, and preserves the original SKU-limit date. An over-30 downgrade sends
a founder alert but is not workspace-locked.

Stripe webhooks remain the primary source of real-time subscription updates.
Opening Settings → Billing also performs a best-effort reconciliation before
rendering when the organization has a Stripe customer, with Stripe network work
capped at five seconds. If Stripe is temporarily unavailable, the page renders
the last-known database state and reports the failure internally. The authorized
`POST /api/billing/resync` endpoint remains available for support and recovery,
but no recovery control is exposed in the customer UI.

During the compatibility release, legacy Core, package, plugin, location, and
annual lookup keys still project to Pro. New checkout never creates them. Remove
that recognition only after every active subscription uses `pro_monthly`.
`scripts/stripe-migrate-subscriptions-to-pro.ts` previews the affected live
subscriptions by default and requires `--apply`. Same-interval subscriptions
preserve renewal dates, disable prorations, and change the next renewal to $199.
Interval changes are marked `MANUAL REVIEW` because Stripe otherwise resets the
billing cycle and can charge immediately; schedule those changes at the current
period end in Stripe.

## Beta features

`organization.betaFeatures` is independent of billing. A feature listed in
`BILLING_BETA_PLUGINS` is hidden and server-denied unless the organization holds
that beta id. Current beta: `pricing_scenarios` for Paonia Soil Co.

Commercial feature gate calls are transition no-ops and should be removed from
their DAL/UI call sites during the contract-cleanup release. The Pricing
Scenarios checks remain and should be renamed as beta-access checks then.

## Compatibility and cleanup

The expand release accepts `trial | free | core | pro`; runtime normalization
maps Trial/Free to Free and Core/Pro to Pro. Existing organizations receive the
same launch-time 15-day transition through the additive migration. Old columns,
usage tables, and the adjustment worker remain temporarily so pending charges
can drain safely.

Migration `0186_free_grace_backfill` moves legacy Core/Pro organizations without
a Stripe subscription to Free while preserving their original SKU-limit date.
Organizations with a Stripe subscription remain Pro. This prevents historical
database labels from granting permanent paid access after the transition.

After one full grace window and verification that no legacy subscriptions or
pending adjustments remain, contract cleanup may remove legacy plan values,
commercial entitlement columns, bands, interval/location/add-on fields, usage
tables, adjustment cron, old catalog parsing, and obsolete rollout environment
variables.
