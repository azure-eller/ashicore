---
read_when:
  - Configuring Sentry production-error automation
  - Investigating or retrying a Sentry Autofix PR
  - Changing the Sentry autofix intake route
---

# Sentry Autofix

Sentry Autofix is an intake and handoff pipeline. Sentry sends a production issue alert to the ERP app, the app creates or updates a GitHub draft PR with a sanitized debug packet, and the PR tags `@codex` to investigate and push the fix to that same branch.

The webhook creates the work item. Codex performs the code change. Humans still review and merge.

## Flow

```txt
Sentry alert
  -> POST /api/internal/sentry/autofix
  -> verify webhook auth
  -> fetch safe Sentry issue/event details
  -> normalize AgentDebugPacket
  -> route to azure-eller/erp or azure-eller/erp-android
  -> create/update agent/sentry-<issueId>-<slug>
  -> open/update draft PR
  -> comment @codex with fix instructions
```

## Required Env Vars

- `SENTRY_AUTOFIX_WEBHOOK_SECRET`: bearer token for manual calls and HMAC secret for Sentry service-hook signatures.
- `SENTRY_AUTH_TOKEN`: Sentry API token with `event:read`.
- `SENTRY_ORG`: Sentry organization slug.
- `SENTRY_WEB_PROJECT`: web Sentry project slug, usually `javascript-nextjs`.
- `SENTRY_ANDROID_PROJECT`: Android Sentry project slug.
- `GITHUB_AUTOFIX_TOKEN`: GitHub token that can create branches, files, labels, PRs, and comments in both repos.
- `GITHUB_WEB_REPO`: optional, defaults to `azure-eller/erp`.
- `GITHUB_ANDROID_REPO`: optional, defaults to `azure-eller/erp-android`.

## Sentry Setup

Create a Sentry internal integration or service hook that posts new or regressed production issue alerts to:

```txt
https://ashicore.app/api/internal/sentry/autofix
```

Configure the hook secret to match `SENTRY_AUTOFIX_WEBHOOK_SECRET`. Manual tests may use:

```bash
curl -X POST https://ashicore.app/api/internal/sentry/autofix \
  -H "Authorization: Bearer $SENTRY_AUTOFIX_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"data":{"issue":{"id":"123456789","project":{"slug":"javascript-nextjs"}}}}'
```

Expected result: a draft PR in the routed repo, a `.autofix/sentry/<issueId>.md` marker commit, a Sentry Autofix Packet in the PR body, and an `@codex` handoff comment.

The intake route is intentionally exempt from Better Auth session redirects in
`proxy.ts`; the route still rejects unauthenticated requests with the configured
Sentry webhook secret.

## Dedupe

The intake dedupes by GitHub PR search for `Sentry issue ID: <id>` in the target repo.

- Open PR found: update marker file and the marked packet block in the PR body, add a latest-occurrence comment, and tag `@codex` only if no prior `@codex` comment exists.
- Merged or closed PR found: create a new branch with `attempt-<n>` in the branch name.
- No PR found: create the stable first-attempt branch `agent/sentry-<issueId>-<slug>`.

Manual retry: resend the same webhook payload or use the curl command above with the same Sentry issue ID.

## Safety Rules

The packet only uses the shared Sentry vocabulary from `docs/observability/sentry-vocabulary.md`. It includes whitelisted tags and whitelisted contexts, strips query strings, and drops sensitive keys.

Never put raw request bodies, response bodies, SQL, SQL parameters, cookies, tokens, passwords, customer-entered notes/comments, addresses, SKUs, quantities, or auth headers into the packet, PR body, comments, or marker files.

## PR Shape

Branches:

```txt
agent/sentry-<issueId>-<slug>
agent/sentry-<issueId>-attempt-2-<slug>
```

PR title:

```txt
[Sentry Autofix] <operation/module/screen>: <error.kind/title>
```

Labels are best-effort:

```txt
sentry-autofix
agent:auto
codex
production-bug
platform:web | platform:android
module:<module>
error:<error.domain>
```

The PR body is the durable Sentry Autofix Packet plus the Codex task. The packet is wrapped in `<!-- sentry-autofix-packet:start -->` / `<!-- sentry-autofix-packet:end -->` markers. Repeated alerts replace only that marked packet block so Codex-added root cause, fix summary, tests, and risk notes stay intact.
