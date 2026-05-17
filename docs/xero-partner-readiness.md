---
read_when:
  - preparing Xero App Store certification or App Partner review
  - changing Xero OAuth token storage, scopes, auth, audit logging, or support docs
  - planning Xero integration hardening beyond routine bug fixes
---

# Xero Partner Readiness

This is the tracker for moving Ashicore's Xero integration from pilot-ready to
partner-review-ready.

## Token storage and rotation

Xero requires secure storage of Xero data, non-exposure of OAuth tokens and
customer-identifying information, and encrypted persistent storage of refresh
tokens using a symmetric algorithm with AES-128 or greater preferred. The app
encrypts both access and refresh tokens.

- Store encrypted tokens in `integrations.connections`.
- Use multi-key decrypt from `XERO_TOKEN_ENCRYPTION_KEYS`.
- Use active-key encrypt from `XERO_TOKEN_ENCRYPTION_KEY_ID`.
- Store `token_encryption_key_id` for decrypt routing and auditability.
- Rotate keys with `pnpm rotate:xero-token-key -- --environment production --apply`.
- Rotation writes redacted evidence to `.xero-evidence/` by default; pass
  `--evidence-file <path>` to store it with the partner packet.
- Keep `docs/xero-security-evidence.md` current for partner-review evidence.

Rollout:

1. Configure production with `XERO_TOKEN_ENCRYPTION_KEYS` and active
   `XERO_TOKEN_ENCRYPTION_KEY_ID`.
2. Redeploy production after env changes.
3. Run the rotation script to re-encrypt rows and verify.
4. Retire the old key only after script verification.
5. Redeploy production after old-key retirement.

## Certification blockers

- **Sign Up with Xero** — implemented as a dedicated App Store acquisition
  route; see `docs/xero-support-listing.md`.
- **Login security** — native MFA is required for every Ashicore account, with authenticator-app and email-code options. Xero requires strong customer authentication with minimum two-step authentication or SSO, and strongly recommends Sign in with Xero.
- **Audit logging** — application access logs plus event-based actions. Logs should include date/time, user or process, event description, success/failure, source, and applicable equipment/location. Retain long enough for investigation, usually at least one year, and keep logs immutable and secure.
- **Security packet** — document hosting, encryption at rest, key management, access control, vulnerability management, monitoring, breach reporting, subprocessors, privacy policy, and support ownership. Current evidence lives in `docs/xero-security-evidence.md`.
- **Support/listing docs** — setup guide, disconnect guide, data-flow diagram, field mapping, FAQ, privacy/support links, pricing/plan details, and marketplace copy/assets.
- **Customer validation evidence** — collect if requested during partner review.

## Audit events

Immutable Xero/accounting events live in `integrations.audit_events`; schema,
retention, and redaction rules are documented in `docs/xero-security-evidence.md`.

## OAuth callback behavior

OAuth callback endpoints that receive auth code/state must validate, persist,
and then return a 302 redirect to an app page. They must not render HTML
directly, which helps avoid leaking sensitive values through Referer headers.

## Granular scopes

Xero granular scopes are active for apps created on or after March 2, 2026.
Apps created before that date have a migration window through September 2027.

Track before certification:

- Whether our Xero app was created before or after March 2, 2026.
- Current broad scopes in `lib/xero/client.ts`.
- Desired least-privilege granular scopes for contacts, invoices, purchase orders, attachments, and future bills.
- Which customers will need reauthorization.
- UX for Xero `401` / `WWW-Authenticate: insufficient_scope`: show an **Update Xero permissions** reconnect flow instead of a generic sync failure.

## Later phases

1. Add Xero/application audit events for connect, disconnect, tenant switch, settings changes, import, push, retry, email, and failure.
2. Decide and implement login-security posture: native 2SA vs Sign in with Xero.
3. Validate Sign Up with Xero against Xero App Store review.
4. Prepare security packet and public support/listing documentation.
5. Plan and execute granular-scope migration.
