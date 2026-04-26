---
read_when:
  - touching anything under `lib/xero/`, `app/api/xero/`, or `app/api/*/xero-*`
  - changing the OAuth scope list in `lib/xero/client.ts`
  - debugging a `xero_push_status='failed'` row in sales_orders or purchase_orders
  - smoke-testing a Xero change before opening a PR
---

# Xero integration

## Where things live

- **OAuth + token refresh** — `lib/xero/client.ts`. `getAuthedXeroClient`
  locks the connection row `FOR UPDATE`, refreshes if the token is within
  60 s of expiry, persists the rotated tokens.
- **Sales push** — `lib/xero/push-invoice.ts`. Reconciles by
  `InvoiceNumber` before issuing a create.
- **PO push** — `lib/xero/push-purchase-order.ts`. Reconciles by
  `getPurchaseOrderByNumber`. Pushes a Xero Purchase Order, **not** an
  ACCPAY Bill — Bills represent supplier invoices and are deferred to a
  future AP workflow.
- **Contact upsert** — `lib/xero/contacts.ts`. Shared by both push paths.
- **Idempotency keys** — `lib/xero/idempotency.ts`. ≤128 chars, stable
  per `(orgId, entity, id, operation)`. Xero retains keys ~6 minutes;
  beyond that, idempotency comes from reconcile-by-reference, not
  the key.
- **Payload hash** — `lib/xero/payload-hash.ts`. Local drift check only;
  Xero does not enforce.
- **Retry cron** — `lib/xero/retry-failed-pushes.ts`, surfaced at
  `GET /api/internal/xero-retry`. Per-org cap of 25 candidates per run,
  per-row cap of 5 attempts. Creates only — never email.

## Required scopes

```
accounting.contacts
accounting.invoices
accounting.transactions    ← needed for PurchaseOrders
offline_access
```

When you add or remove a scope, every existing connection must
disconnect + reconnect for the OAuth consent to re-prompt. The
**Test connection** button in settings will surface this as
`Missing scope`.

## Testing — use the Xero Demo Company

There is no Xero "sandbox API" you can hit anonymously. Instead Xero
gives every user a built-in **Demo Company** tenant. Use it for
everything until you need a final pilot-tenant pass.

1. Click **Connect** on `/settings/integrations`.
2. On Xero's consent screen, pick **Demo Company** as the organisation
   to grant access to.
3. Approve all requested scopes.
4. Set `defaultAccountCode` (e.g. `200`) and tax type in the panel —
   the Demo Company comes pre-loaded with a real chart of accounts.
5. Confirm with the **Test connection** button — should say `Connected`.

Demo Company properties:

- Pre-loaded with fake contacts, items, accounts, tax codes
- Demo contacts have throwaway emails, so even with
  `auto_email_sales_invoices=true` nothing reaches a real customer
- **Auto-resets every 28 days** — your `xero_invoice_id`,
  `xero_purchase_order_id`, and `xero_contact_id` columns will start
  pointing to documents that no longer exist. If `Pushed` rows go
  "missing" in Xero, this is why. Disconnect + reconnect and clear
  out the affected rows to start fresh.
- Tenant id is unique per user, so two devs each get their own demo
  tenant — no collisions.

### Promoting to the pilot tenant

Once Demo Company smoke is green:

1. Disconnect from Demo Company.
2. Reconnect, picking the pilot tenant.
3. **Keep `auto_email_sales_invoices` OFF** for any test runs against
   the pilot — we don't want test invoices reaching real customers.
4. Use a TEST- prefix on order numbers so they're easy to find and
   void/delete in Xero afterwards.

## Manual smoke checklist

After any change in `lib/xero/` or in either push hook
(`shipSalesOrder`, `submitPurchaseOrder`):

1. **Sales happy path.** Confirm + ship an order. Expect a row in Xero
   under Business → Invoices, with `xero_push_status='pushed'` and
   `xero_invoice_id` populated locally. If `auto_email_sales_invoices`
   is on, expect `xero_email_status='sent'`.
2. **Purchase happy path.** Submit a draft PO. Expect a row in Xero
   under Business → Purchase orders, with the same fields populated.
3. **Failure path.** Revoke the access token from inside Xero
   (Settings → Connected apps → revoke). Ship another order. Expect
   `xero_push_status='failed'`, the order detail page to show the
   "Retry Xero push" action, and the **Test connection** button to
   surface `Reconnect required`. Reconnect, click Retry — should
   recover.
4. **Cron path.** Force a few failed rows, then poke the cron:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
     http://localhost:3000/api/internal/xero-retry
   ```
   Expect the response JSON to show `recovered > 0` and the rows
   to flip back to `pushed` without a duplicate Xero document.
5. **Idempotency past the 6-minute window.** Manually delete the
   `xero_invoice_id` from a row whose Xero invoice still exists, then
   trigger retry. The push should adopt the existing Xero invoice via
   `findXeroInvoiceForSalesOrder` rather than creating a duplicate.

## Why there are no automated Xero tests

Playwright is the only test runner per `CLAUDE.md`, and live OAuth
into a real Xero tenant is not a thing CI should do. The tradeoff:

- Local flows in `pushSalesOrderToXero` / `pushPurchaseOrderToXero`
  throw `XeroError('not connected', 409)` when there is no
  `xero_connections` row. `shipSalesOrder` and `submitPurchaseOrder`
  treat that specific 409 as "Xero isn't set up — leave push status
  null", so the existing Playwright suites pass with no Xero stubs.
- Anything Xero-specific (idempotency, reconcile-by-reference, scope
  detection) is verified manually against the Demo Company before
  shipping.

If a future change makes the local code path itself depend on a Xero
response shape, add a Playwright spec that runs against a separate
Demo Company tenant gated behind an env flag — keep it out of the
default `pnpm test` lane.
