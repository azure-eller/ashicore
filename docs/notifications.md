---
read_when:
  - Planning or implementing notifications or push delivery
  - Adding a new notification event type
  - Changing notification APIs or preferences
  - Debugging missing or delayed pushes
---

# Notifications

## Pipeline

Event → `notify(orgId, event)` → preference-filtered rows in `reporting.notifications` (durable record) → best-effort FCM push per registered device.

`notify()` is the single entry point (`lib/notifications/notify.ts`). It:
1. Reads `notification_preferences` for users with `enabled = true` for the event type.
2. Inserts one `notifications` row per subscriber (`deliveryStatus = 'created'`).
3. Looks up `push_devices` for those users and calls `sendPush()` per device.
4. Updates `deliveryStatus` to `'delivered'` (all sends ok) or `'failed'` (any send failed). Dead FCM tokens are deleted immediately.

Without `FIREBASE_SERVICE_ACCOUNT_KEY` set, `sendPush()` writes a JSON file to `.tmp/fcm-outbox/` instead — same behavior as the email outbox, and the Playwright test seam.

## Hard rules

- **`notify()` fires post-commit only.** Never call it inside an `...InTx` function or transaction callback. A notification must not reference uncommitted work.
- **`notify()` never throws.** A push failure must never fail the business mutation.
- **Every MO creation path must call `notifyManufacturingOrderCreated()`.** Currently: `createManufacturingOrder`, `createManufacturingOrdersFromSalesOrder`, `createManufacturingOrderDraftFromPlanning`.
- **MO done and PO receipt notifications are ledger-backed lifecycle announcements.** Emit them from the post-commit wrappers around the domain mutations that write `manufacturing_output` and `purchase_receipt` inventory ledger events, not from a polling job and not inside the inventory transaction.
- **PO received means any successful receipt.** Partial and full receipts both emit `purchase_order_received`; the body says whether the PO is now partially or fully received.

## Subscribable events

| Event type | Entity type | Fires when |
|---|---|---|
| `manufacturing_order_created` | `manufacturing_order` | An MO is created from direct create, sales-order create, or planning. |
| `manufacturing_order_completed` | `manufacturing_order` | An MO transitions to `done` after production output is recorded. |
| `purchase_order_received` | `purchase_order` | Any successful PO receipt records purchase inventory. |

## `deliveryStatus` semantics

| Value | Meaning |
|---|---|
| `created` | Row written; push not attempted (no registered devices, or fan-out interrupted) |
| `delivered` | All device sends succeeded (includes outbox writes) |
| `failed` | At least one device send failed |

## Tables

**`reporting.notification_preferences`** — org-scoped, RLS + `FORCE ROW LEVEL SECURITY`. No row = off (opt-in by default). Unique on `(organizationId, userId, eventType)`. Only covers `SUBSCRIBABLE_EVENT_TYPES`; `daily_manufacturing_report` uses its own `report_recipients` model.

**`reporting.push_devices`** — user-scoped, no org column, user-isolation RLS via `app.current_user_id`. A token belongs to a person across org contexts. DAL always sets the session `userId` before touching the table. Capped at 10 devices per user; the just-registered token is preserved and stale tokens are evicted on each register call. Token ownership reassigns on re-login (shared devices).

## API surface (mobile contract)

- `GET /api/notification-preferences` — list current user's preferences for all subscribable event types (missing row returns `enabled: false`)
- `PUT /api/notification-preferences` — upsert `{ eventType, enabled }` for current user
- `POST /api/push-devices` — register `{ token, platform: "android" }`; upserts by token
- `DELETE /api/push-devices` — remove `{ token }` for current user

Any authenticated org member manages only their own settings. No module-access gate by design.

## Adding an event type

1. Add to `NOTIFICATION_TYPES` in `lib/reports/constants.ts`; add to `SUBSCRIBABLE_EVENT_TYPES` if user-subscribable.
2. Widen the `CHECK` constraints on `notifications.type`, `notifications.entity_type`, and `notification_preferences.event_type` via a new migration.
3. Add an explicit branch in `notificationKindFor()` — the keyword fallback is not sufficient for correctness.
4. Keep `NotificationKind.kt` in the Android repo in lockstep.
5. Write an event-specific wrapper (see `lib/notifications/manufacturing.ts`) and call it from the post-commit seam of the mutating wrapper.

## Firebase setup (one-time per environment)

Done 2026-06-10: Firebase project `ashicore`, Android app `com.ashicore.app`,
`FIREBASE_SERVICE_ACCOUNT_KEY` set in Vercel project `erp` (production). For a
new environment:

1. Firebase console → add project → add Android app (use the `erp-android` applicationId) → download `google-services.json` into the Android repo.
2. Firebase console → Project settings → Service accounts → Generate new private key.
3. `base64 -w0 key.json | vercel env add FIREBASE_SERVICE_ACCOUNT_KEY production`.

Do NOT set the key in local `.env.local`: a configured key makes dev servers
send real FCM calls, which breaks the fan-out test's outbox seam and fires live
requests with test tokens. Local dev/test runs on the outbox by design. If
real-device local testing is ever needed, first add an `FCM_OUTBOX_ONLY`
flag-file override mirroring `lib/email/outbox.ts`.

Until the key is set, notification rows still write and pushes go to the outbox.

## Out of scope (v1)

- Web bell / in-app notification UI
- Email channel for event notifications
- Retry worker for the FCM outbox
