---
read_when:
  - preparing Xero App Store certification or App Partner review
  - changing Xero OAuth token storage, scopes, audit logging, or support docs
  - reviewing Xero/accounting integration security controls
  - rotating Xero token encryption keys
  - responding to a Xero token, OAuth credential, or integration data incident
  - documenting Xero security, retry, breach response, or assessment evidence
---

# Xero Security Evidence

## Token Storage And Key Management

Xero OAuth access and refresh tokens are stored only as AES-256-GCM ciphertext
in `integrations.connections`. The row stores `token_encryption_key_id` so the
app can decrypt historical rows with the correct configured key.

Runtime config:

- `XERO_TOKEN_ENCRYPTION_KEYS` — JSON map of key id to 32-byte base64 key.
- `XERO_TOKEN_ENCRYPTION_KEY_ID` — active key id for new/refreshed tokens.
- `XERO_TOKEN_ENCRYPTION_KEY` — legacy/local fallback during rollout.

Rotation is operator-run automation, not app-runtime secret management:

```bash
pnpm rotate:xero-token-key -- --environment production --apply
```

The script updates Vercel production env to include old + new keys, requires a
production redeploy checkpoint, rotates accounting connection token rows in
per-row transactions, verifies all rows decrypt under the active key, and
requires `retire <oldKeyId>` before removing the old key and legacy fallback
from Vercel env. Redeploy production again after retirement.

The script never logs token plaintext, full ciphertext, full DB URLs, or full
secret values. Its audit summary records old/new key ids, row counts, failures,
and whether the old key was retired.

## Immutable Audit Events

Xero/accounting integration actions are recorded in
`integrations.audit_events`. The table is org-scoped, RLS protected, and
append-only for the app role.

Each event records:

- occurred time
- actor type plus user id or process name
- event type and success/failure outcome
- source route/job/helper
- provider
- tenant id/name when known
- local entity type/id when applicable
- redacted metadata

Covered events include OAuth callback success/failure, disconnect, tenant
switch, settings changes, imports, import undo, auto-sync, pushes, retries,
emails, token refresh failures, and missing-scope detection.

Metadata is recursively redacted by `lib/accounting/audit-events.ts`. Do not
store OAuth codes, access tokens, refresh tokens, cookies, raw request bodies,
passwords, customer notes, or free-form comments in audit metadata.

## Retry And Error Handling

Xero document push retries are handled by `GET /api/internal/xero-retry` and
`lib/xero/retry-failed-pushes.ts`.

- Per-org retry candidate cap: 25 rows per run.
- Per-row retry cap: 5 attempts.
- Retry creates documents only; it never sends customer or supplier email.
- Push functions reconcile by deterministic Xero references before create, so
  retries after Xero's short idempotency window do not create duplicates.
- Permanent OAuth refresh failures surface as reconnect-required user states.
- Transient Xero refresh failures return retry-later behavior instead of asking
  users to reconnect unnecessarily.

Manual evidence:

- Run `pnpm xero:smoke` against Xero Demo Company for happy path, failure path,
  idempotency/reconcile, and retry cron coverage.
- Capture the final script summary when rotating token keys.
- Keep Sentry issue links or request IDs for production Xero failures.

## Retention

Retain audit events for at least one year for partner-review and incident
investigation evidence. Do not purge or rewrite rows without an explicit
retention policy change and a migration/ops plan.

## Breach Response

For suspected Xero token or token-encryption-key exposure:

1. Disable Xero automation toggles if ongoing writes could worsen impact.
2. Preserve evidence: Sentry issue, request IDs, Vercel logs, audit notes, and
   affected org/tenant IDs. Do not paste tokens, raw bodies, or customer notes.
3. Rotate the token encryption key with `pnpm rotate:xero-token-key`.
4. If OAuth tokens may be exposed, revoke affected Xero app connections and ask
   impacted customers to reconnect.
5. If `XERO_CLIENT_SECRET` may be exposed, rotate it in the Xero developer
   portal, update Vercel env, redeploy, and verify connect/test connection.
6. Notify affected customers with scope, time window, actions taken, and any
   customer action required.
7. Record the incident summary, owner, timeline, evidence, and follow-up fixes.

## Annual Security Assessment

Owner: Ashicore technical owner.

Cadence: at least annually before Xero partner renewal/review, and after any
material auth, hosting, OAuth scope, token storage, or incident-response change.

Assessment checklist:

- Verify production token encryption config and key rotation runbook.
- Review Xero scopes against least-privilege requirements.
- Review Sentry redaction and production logging hygiene.
- Run the Xero Demo Company smoke path.
- Confirm retry caps, reconnect behavior, and customer-facing failure states.
- Review production access to Vercel, Neon, Xero developer app, and Sentry.
