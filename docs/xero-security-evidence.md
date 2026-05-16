---
read_when:
  - preparing Xero App Store certification or App Partner review
  - changing Xero OAuth token storage, scopes, audit logging, or support docs
  - reviewing Xero/accounting integration security controls
---

# Xero Security Evidence

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

## Retention

Retain audit events for at least one year for partner-review and incident
investigation evidence. Do not purge or rewrite rows without an explicit
retention policy change and a migration/ops plan.
