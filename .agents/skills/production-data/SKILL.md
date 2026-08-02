---
name: production-data
description: Inspect or intentionally change Ashicore production data in Neon/Postgres. Use for production business-data questions, SQL investigation, org-scoped counts, Neon targets, recovery checkpoints, and approved production SQL; not for Sentry or deployment-log triage.
---

# Production data

Read `docs/database.md` under **Production Data Access**.

Put SQL in a temporary file, then use the repo boundary:

```bash
pnpm ops:production-db -- --org-slug <slug> --sql-file <path>
```

Reads are transactionally read-only. The command pulls current Vercel production
env when `--env-file` is omitted, verifies the ERP Neon target, uses `app_user`,
and sets the RLS organization context. Keep queries bounded and select only
fields needed to answer the question.

Before unfamiliar SQL, inspect only the matching domain file under
`lib/db/schema/`; ERP tables are schema-qualified (for example,
`purchasing.purchase_orders`). The command contract above is authoritative; do
not inspect its implementation unless it fails unexpectedly.

For a write, first show the user the exact target, SQL, and expected effect.
After explicit approval, rerun with `--write`. The helper attempts a seven-day
recovery checkpoint. Add `--verify-sql-file <path>` to verify the committed result.
`--owner`, `--no-transaction`, and `--skip-checkpoint` are available when the
approved operation genuinely needs them; explain their use.
Warnings about bypassing a domain path are judgment prompts, not blanket bans.

Use local `vercel`/`neonctl` login or remote `VERCEL_TOKEN` and project-scoped
`NEON_API_KEY`. Do not use Neon MCP against production. Never print or paste a
database URL, password, or provider token.
