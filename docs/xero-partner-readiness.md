---
read_when:
  - preparing Xero App Store certification or App Partner review
  - changing Xero OAuth token storage, scopes, auth, audit logging, or support docs
  - planning Xero integration hardening beyond routine bug fixes
---

# Xero Partner Readiness

This is the tracker for moving Ashicore's Xero integration from pilot-ready to
partner-review-ready.

## Current PR: encrypted token storage

Xero requires secure storage of Xero data, non-exposure of OAuth tokens and
customer-identifying information, and encrypted persistent storage of refresh
tokens using a symmetric algorithm with AES-128 or greater preferred. This PR
encrypts both access and refresh tokens.

- Store encrypted tokens in `xero.xero_connections`.
- Drop legacy plaintext token columns.
- Use one active encryption key from `XERO_TOKEN_ENCRYPTION_KEY`.
- Store `token_encryption_key_id` for future rotation and auditability.
- Multi-key decrypt / active-key rotation is not implemented in this PR.
- Existing Xero connections are removed during migration and must reconnect.

Rollout:

1. Set `XERO_TOKEN_ENCRYPTION_KEY` and `XERO_TOKEN_ENCRYPTION_KEY_ID` in production.
2. Deploy migration and code together.
3. Reconnect the pilot customer in Xero settings.
4. Verify the new row has `refresh_token_ciphertext` populated.
5. Smoke test the connected Xero tenant.

## Certification blockers

- **Sign Up with Xero** — implemented as a dedicated App Store acquisition
  route; see `docs/xero-support-listing.md`.
- **Login security** — decide native 2SA vs Sign in with Xero. Xero requires strong customer authentication with minimum two-step authentication or SSO, and strongly recommends Sign in with Xero.
- **Audit logging** — application access logs plus event-based actions. Logs should include date/time, user or process, event description, success/failure, source, and applicable equipment/location. Retain long enough for investigation, usually at least one year, and keep logs immutable and secure.
- **Security packet** — document hosting, encryption at rest, key management, access control, vulnerability management, monitoring, breach reporting, subprocessors, privacy policy, and support ownership.
- **Support/listing docs** — setup guide, disconnect guide, data-flow diagram, field mapping, FAQ, privacy/support links, pricing/plan details, and marketplace copy/assets.
- **Customer validation evidence** — collect if requested during partner review.

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
