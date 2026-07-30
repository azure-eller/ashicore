---
read_when:
  - touching anything under `lib/xero/`, `app/api/xero/`, or `app/api/*/xero-*`
  - changing the OAuth scope list in `lib/xero/client.ts`
  - debugging a failed Xero row in `accounting.document_syncs`
  - smoke-testing a Xero change before opening a PR
  - preparing Xero App Store certification or partner-readiness work
---

# Xero integration

For App Store / App Partner certification gaps, rollout sequencing, and future
security work, read `docs/xero-partner-readiness.md`. For customer-facing App
Store setup/support copy, read `docs/xero-support-listing.md`.

## Where things live

- **OAuth + token refresh** — `lib/xero/client.ts`. `getAuthedXeroClient`
  locks the connection row `FOR UPDATE`, decrypts stored tokens using the row's
  `token_encryption_key_id`, refreshes if the token is near expiry, and
  persists the rotated token pair encrypted with the active key.
- **Sign up with Xero** — `/api/xero/sign-up` starts the App Store acquisition
  OAuth flow. `/api/xero/callback` stores a short-lived encrypted signup intent,
  then Better Auth endpoints under `/api/auth/xero-signup/*` create a
  passwordless owner account or link the intent to a signed-in existing user.
- **Sales push** — `lib/xero/push-invoice.ts`. Reconciles by
  `InvoiceNumber` before issuing a create. Sales orders can be sent manually
  from the order header; shipped orders can still auto-send when the org
  enables invoice automation. Orders with cancelled remaining sales quantities
  are blocked before provider push until shipped-only invoicing is designed.
- **Purchase bill push** — `lib/xero/push-purchase-bill.ts`. Creates Xero
  `ACCPAY` draft bills from ERP purchase orders before or after receipt. The
  action is manual from the PO bill status, saves a valid dirty PO card before
  opening bill management and again before pushing,
  stores a provider-neutral `purchase_bill` sync snapshot, uses ordered
  purchase-unit line economics, includes selected additional costs in the
  resolved supplier group, uses the selected bill-dialog account for all bill
  lines, and defaults that field from the configured purchase-bill account with
  legacy default-account fallback. Inventory lots and lot-tracking mode are
  operational ERP state and are not sent to Xero. Bill line descriptions use
  canonical variant display names, repairing legacy base-only PO line snapshots
  without duplicating an existing option suffix.
  Retry/adoption checks existing ACCPAY
  bills by supplier invoice number, but only links a match when Xero contact,
  reference, and subtotal match the ERP purchase order. The Xero retry cron
  also checks pushed purchase bills and resets local bill status to Not billed
  when the external Xero bill has been deleted, voided, or is no longer found.
- **PO export unsupported** — ERP purchase orders are the purchasing source of
  truth. The app has no executable path for creating Xero purchase orders or
  emailing Xero-rendered PO PDFs. Legacy export routes return HTTP 410 so old
  clients fail explicitly; historical sync rows remain readable.
- **Contact upsert** — `lib/xero/contacts.ts`. Used by sales invoice push and
  purchase bill push.
- **Contact import** — `lib/xero/import-contacts.ts`. Customer/supplier
  imports preview counts before writing, record `xero_import_runs`, and
  can reset a completed run when imported rows are not referenced by orders.
  Fetch active contacts, update matching ERP rows by Xero ID/email/name, but
  only create new rows for Xero contacts flagged as customers or suppliers.
- **Profit & Loss overhead inputs** — `lib/xero/reports.ts` fetches one P&L
  report and the chart of accounts for the Sales overhead calculator.
  Server-only `lib/overhead/parse.ts` converts the Xero report's leaf account
  rows and normalises accounting-style parenthesised negatives; browser-safe
  `lib/overhead/compute.ts` applies the account-type rules and org overrides,
  then derives the overhead share of revenue. Unrecognised or absent account
  types default to Excluded, and the worksheet warns while that automatic
  classification remains unresolved. This split lets the client worksheet
  preview the same arithmetic without bundling `xero-node`. Missing report
  scope (`403`), an expired or revoked refresh token (`401`), and no connection
  for the org (`409`) become `reason: "missing_scope"` so the overhead worksheet
  can direct the operator to reconnect from **Settings > Integrations**.
- **Supplier price sync retired** — the previous history-driven supplier item
  price updater is no longer exposed because Xero line units are not reliable
  enough to infer ERP stock-unit costs automatically.
- **PO import** — `lib/accounting/import-purchase-orders.ts`. Provider-first
  purchase order import for ERP receiving. The current provider adapter fetches
  open Xero or QuickBooks POs, while routes/UI/orchestration stay under
  `/api/accounting/import/*` so providers plug in without changing the workflow.
  Manual bulk import previews open provider POs with selectable rows; auto-sync
  imports only rows that are safe without human unit review. It skips POs that
  would create materials, duplicate an ERP material across provider lines, or
  use a material without an explicit purchase-to-stock conversion.
  Existing received ERP PO lines are protected from re-import changes that would
  rewrite receipt history. Re-import also preserves locally assigned
  additional-cost suppliers when the old and incoming cost rows match
  unambiguously; duplicate or otherwise ambiguous costs are left unassigned
  instead of guessing a vendor.
- **Provider adapters** — `lib/accounting/providers/*`. Keep provider-specific
  OAuth/API/payload mapping here. Shared workflows must depend on the
  `AccountingConnector` interface, not `lib/xero/*` or QuickBooks files.
- **Idempotency keys** — `lib/xero/idempotency.ts`. ≤128 chars, stable
  per `(orgId, entity, id, operation)`. Xero retains keys ~6 minutes;
  beyond that, idempotency comes from reconcile-by-reference, not
  the key.
- **Payload hash** — `lib/xero/payload-hash.ts`. Local drift check only;
  Xero does not enforce.
- **Generic sync state** — Xero writes provider-neutral document and attachment
  sync rows under `accounting.*`; historical PO export rows are retained for
  audit/history only.
- **Retry cron** — `lib/xero/retry-failed-pushes.ts`, surfaced at
  `GET /api/internal/xero-retry`. Per-org cap of 25 sales-invoice retry
  candidates and 25 pushed purchase-bill checks per run; sales-invoice rows
  stop after 5 attempts. It retries sales-invoice creates only and never sends
  email. It also reconciles pushed Xero purchase bills so deleted/voided
  external bills revert to Not billed locally.

## Token encryption keys

Production supports multi-key decrypt with `XERO_TOKEN_ENCRYPTION_KEYS` and
active-key writes with `XERO_TOKEN_ENCRYPTION_KEY_ID`. Keep
`XERO_TOKEN_ENCRYPTION_KEY` only as a legacy/local fallback.

Rotate keys with the operator script:

```bash
pnpm rotate:xero-token-key -- --environment production --apply
```

The script updates Vercel env, pauses for production redeploy, rotates DB rows,
verifies every Xero row, gates old-key retirement, and reminds you to redeploy
again. See `docs/xero-security-evidence.md`.

## Required scopes

```
accounting.contacts
accounting.invoices
accounting.transactions    ← needed for Xero purchase-order import and health checks
accounting.reports.read     ← needed for the overhead calculator's Profit & Loss
accounting.settings.read    ← needed for the overhead calculator's account types
offline_access
```

When you add or remove a scope, every existing connection must reconnect for
the OAuth consent to re-prompt. The **Test connection** health probe detects
missing transaction scope. Report scope is verified by loading the P&L from a
pricing scenario's overhead worksheet. Missing report scope (`403`), an expired
or revoked refresh token (`401`), or no connection (`409`) directs the operator
to **Settings > Integrations** to reconnect.

## Testing — use the Xero Demo Company

There is no Xero "sandbox API" you can hit anonymously. Instead Xero
gives every user a built-in **Demo Company** tenant. Use it for
everything until you need a final pilot-tenant pass.

1. Click **Connect** on `/settings/integrations`.
2. On Xero's consent screen, pick **Demo Company** as the organisation
   to grant access to.
3. Approve all requested scopes.
4. Set the sales invoice account, purchase bill account, and tax type in the
   panel — the Demo Company comes pre-loaded with a real chart of accounts.
5. Confirm with the **Test connection** button — should say `Connected`.

Demo Company properties:

- Pre-loaded with fake contacts, items, accounts, tax codes
- Demo contacts have throwaway emails, so even with
   `auto_email_sales_invoices=true` nothing reaches a real customer
- **Auto-resets every 28 days** — external IDs in local sync/contact records
  can start pointing to documents that no longer exist. If pushed records go
  "missing" in Xero, this is why. Disconnect + reconnect and clear out the
  affected test records to start fresh.
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

After any change in `lib/xero/` or in the sales push hook (`shipSalesOrder`):

1. **Sales happy path.** Confirm + ship an order. Expect a row in Xero
   under Business → Invoices, with a `sales_order` row in
   `accounting.document_syncs` whose `push_status='pushed'` and
   `external_document_id` is populated. If `auto_email_sales_invoices`
   is on, expect the sync row's `email_status='sent'`.
2. **Purchase bill happy path.** Create or receive an ERP PO, open Bill actions
   > Manage bills..., enter supplier invoice metadata, and include or omit
   additional costs as needed. Expect a draft payable bill in Xero with ordered
   purchase-unit quantities, selected additional costs, and a local
   `purchase_bill` document sync row.
3. **Purchase import happy path.** Enable purchase order import or run bulk
   import. Expect open Xero POs to appear in ERP for receiving; received ERP PO
   lines must not be rewritten by later imports.
4. **Overhead report path.** Open a pricing scenario, click **Recalculate from
   Xero** on the Overhead field, load a completed period,
   and confirm the account amounts match the same Xero P&L. Confirm the automatic
   classifications and that the Revenue, Overhead pool, and Excluded totals
   reconcile with the account ledger. Confirm a parenthesised negative amount in
   Xero appears as a negative account row rather than disappearing. If an account
   has an unrecognised or absent type, expect a warning that it defaults to
   Excluded; classify that account manually and expect the warning to clear.
   Change one account bucket and confirm the equation and totals update before
   saving, then open a new pricing scenario. Expect its overhead field to contain
   the saved derived percentage. For a connection authorised before
   `accounting.reports.read` was added, an expired or revoked refresh token, or
   an org with no Xero connection, expect a reconnect prompt that links to
   **Settings > Integrations**; reconnect there, return to the scenario, and load
   the report again.
5. **Failure path.** Revoke the access token from inside Xero
   (Settings → Connected apps → revoke). Ship another order. Expect
   `xero_push_status='failed'`, the order detail page to show the
   "Retry Xero push" action, and the **Test connection** button to
   surface `Reconnect required`. Reconnect, click Retry — should
   recover.
6. **Cron path.** Force a few failed rows, then poke the cron:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
     http://localhost:3000/api/internal/xero-retry
   ```
   Expect the response JSON to show `recovered > 0` and the rows
   to flip back to `pushed` without a duplicate Xero document.
7. **Idempotency past the 6-minute window.** Manually delete the
   `external_document_id` from a `sales_order` sync row whose Xero invoice
   still exists, then trigger retry. The push should adopt the existing Xero
   invoice via `findXeroInvoiceForSalesOrder` rather than creating a duplicate.

## Why there are no automated Xero tests

Playwright is the only test runner per `CLAUDE.md`, and live OAuth
into a real Xero tenant is not a thing CI should do. The tradeoff:

- Local flows in `pushSalesOrderToXero`
  throw `XeroError('not connected', 409)` when there is no
  `xero_connections` row. `shipSalesOrder` treats that specific 409 as
  "Xero isn't set up — leave push status null", so the existing Playwright
  suites pass with no Xero stubs.
- Anything Xero-specific (idempotency, reconcile-by-reference, scope
  detection) is verified manually against the Demo Company before
  shipping.

If a future change makes the local code path itself depend on a Xero
response shape, add a Playwright spec that runs against a separate
Demo Company tenant gated behind an env flag — keep it out of the
default `pnpm test` lane.
