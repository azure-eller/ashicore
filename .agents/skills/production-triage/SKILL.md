---
name: production-triage
description: Investigate Ashicore production errors, Sentry issues or events, request IDs, failed Vercel deployments, runtime logs, and slow requests. Use for production incident diagnosis across Sentry and Vercel; not for querying business data.
---

# Production triage

Read `docs/observability/sentry-triage.md`. For unfamiliar event fields, also
read `docs/observability/sentry-vocabulary.md`.

Targets:

- Sentry org `7050technologies`, web project `javascript-nextjs`
- Vercel app project `erp`; use `www` only for the public marketing/docs site

Use `pnpm dlx sentry` and `pnpm dlx vercel@latest`; the latest agent-oriented
commands may be newer than globally installed CLIs. Prefer dedicated commands,
JSON, selected fields, small limits, and exact issue/event/request IDs. Let each
CLI use existing login; on a remote agent use `SENTRY_AUTH_TOKEN` and
`VERCEL_TOKEN`. If auth fails, report the one missing login/secret instead of
trying unrelated access paths.

For API/render failures:

1. Inspect the Sentry issue or event directly. Do not start with broad search.
2. Extract `request_id`, route, method, source, operation, domain, and timestamp.
3. Correlate it with:
   `pnpm dlx vercel@latest logs --project erp --environment production --request-id <id> --json`
4. Trace the implicated code and report evidence, confidence, and next action.

An already configured official Sentry or Vercel MCP is an acceptable fallback,
but do not stop to install or configure MCP when the CLI works.

Never reproduce secrets, raw bodies, SQL, customer notes, addresses, SKUs, or
quantities in comments, PRs, or reports. Before resolving an issue, rolling
back, redeploying, or changing provider state, show the exact target and action
and obtain explicit approval.
