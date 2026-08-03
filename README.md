# Ashicore

Inventory-first operations app for a small-scale MRP workflow.

This README is for coding agents and engineers working in the repo. It is a runbook, not a product overview.

## Current Scope

Active domains:

- inventory items, lots, stock movements, and stocktakes
- products and BOMs
- sales orders and customers
- purchase orders and suppliers
- manufacturing orders
- Better Auth org/team management
- Xero/QuickBooks accounting document sync

Explicitly out of scope today:

- multi-location inventory
- accounting ledger, AP/AR, GL, or payments
- full invoicing workflows beyond accounting document sync
- work-center or capacity planning
- auto-generated MRP runs

## Stack

- Next.js App Router
- React 19
- Drizzle ORM
- Neon Postgres
- Better Auth
- shadcn/ui
- TanStack Query + TanStack Table
- react-hook-form + Zod
- Playwright
- pnpm

## Agent Quick Start

This repo is optimized for coding agents working in isolated worktrees. The
repo-root checkout should stay on `main`; do not edit feature files there.

1. Read `AGENTS.md` first. It is a symlink to `CLAUDE.md`, which is the
   repo-wide source of truth.

2. Create a dedicated worktree from the repo root:

```bash
git worktree add .worktrees/<branch-name> -b <branch-name>
cd .worktrees/<branch-name>
```

3. For feature work, start the agent dev environment:

```bash
pnpm boot
```

`pnpm boot` installs dependencies when needed, prepares the worktree-local
database, runs migrations, creates the test session, starts the dev server on a
free port, and writes `.tmp/agent-session.json`. Worktree servers stop after 30
minutes without workflow activity; `pnpm boot`, Playwright, and review workflows
resume the current server as needed. Run `pnpm servers` to inspect every
worktree server's status, memory, URL, and idle age.

4. For live triage against the Paonia production-copy data, use sandbox mode
   instead of boot:

```bash
pnpm sandbox [path]
```

5. Finish docs-only PRs with:

```bash
pnpm review <path> --docs-only
```

For code changes, follow the relevant domain docs and finish with the slow
domains required by `docs/testing.md`.

## Manual Local Setup

Use this only for maintainer/manual development. Agents should prefer the quick
start above.

1. Install dependencies:

```bash
pnpm install
```

2. Create the shared repo-root env:

```bash
cp .env.example .env.local
```

3. Fill the non-database values you need in `.env.local` like
   `BETTER_AUTH_SECRET`.

4. In each worktree, create that worktree's local DB and env:

```bash
pnpm db:local:setup
```

5. Start the app:

```bash
pnpm dev
```

Local Playwright commands start or resume the worktree dev environment through
`pnpm boot` when its server is not running.

## Environment Variables

Required for normal app runtime:

- `DATABASE_URL_APP`: app runtime connection string for the restricted app role
- `DATABASE_URL`: owner connection string for migrations only

Required for auth / absolute URLs:

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL` or `NEXT_PUBLIC_APP_URL`
- `RESEND_API_KEY` in production for invites, password reset, and email verification
- `EMAIL_FROM` optionally overrides the default `Ashicore <noreply@ashicore.app>` sender
- `SENTRY_DSN` in production for server and edge Sentry events
- `NEXT_PUBLIC_SENTRY_DSN` in production for browser errors, tracing, and session replay

Optional:

- `BETTER_AUTH_ALLOWED_HOSTS`: comma-separated extra host patterns for LAN IPs or tunnel hosts. `localhost`, `127.0.0.1`, and `[::1]` on any port already work.
- `TEST_BASE_URL`: overrides Playwright base URL
- `PORT`: local fallback if you do not set an app URL
- `SENTRY_AUTH_TOKEN`: enables source-map upload and remote-agent Sentry CLI access
- `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_RELEASE`: configure Sentry source-map upload and release tagging
- `VERCEL_TOKEN`: authenticates remote-agent Vercel CLI access and production env pulls
- `NEON_API_KEY`: authenticates production-target verification and recovery checkpoints; use a project-scoped key
- `ERP_DEV_IDLE_MINUTES`: sets the idle timeout when the repo-wide dev-server reaper starts (30 minutes by default)

## Database Notes

- `DATABASE_URL` is the owner connection. Use it for migration generation/application only via `pnpm db:generate` and `pnpm drizzle-kit migrate`.
- `DATABASE_URL_APP` is the app role. Use it for normal app runtime so RLS is actually exercised.
- Default local dev is one shared local Postgres instance plus one database per worktree.
- `pnpm db:local:setup` auto-starts local Postgres when needed, derives the database name from the current worktree folder, creates `app_user`, writes worktree-local DB URLs, and runs migrations.
- After a PR is merged or closed, delete its matching Neon `preview/<git-branch>` branch before running `pnpm worktree:cleanup <branch>` from the repo root. Never delete `production`, `vercel-dev`, a protected branch, or a preview for an open PR. The cleanup command drops that branch's local DB, removes the worktree, deletes the local branch when possible, and stops Docker Postgres when no linked worktrees remain; use `--force` for a closed, unmerged PR.
- Local Postgres data persists across `pnpm db:local:stop`. You do not need to reseed on each start.
- If you already run Postgres locally, set `LOCAL_DB_ADMIN_URL` before `pnpm db:local:setup` and skip Docker.
- Do not use `drizzle push`.
- New schemas and tables must follow the RLS and grant rules in `docs/database.md`.

## Commands

Core:

```bash
pnpm dev
pnpm build
pnpm lint
pnpm test
pnpm test:invariants
```

Focused fast tests:

```bash
pnpm test:fast:inventory
pnpm test:fast:sales
pnpm test:fast:purchasing
pnpm test:fast:manufacturing
pnpm test:fast:planning
```

Focused slow stories:

```bash
pnpm test:slow:sales
pnpm test:slow:purchasing
pnpm test:slow:manufacturing
pnpm test:slow:planning
pnpm test:slow:stocktake
pnpm test:slow:auth
```

Database:

```bash
pnpm db:local:setup
pnpm worktree:cleanup <branch>
pnpm db:local:start   # optional manual control
pnpm db:local:stop
pnpm db:generate
pnpm ops:production-db -- --org-slug <slug> --sql-file <path>
pnpm drizzle-kit migrate
```

## Testing

- E2E only. App behavior is covered with Playwright.
- `test/global-setup.ts` provisions the test session and writes `test/.test-env.json`.
- Start `pnpm dev` before running Playwright locally.
- The test org is isolated by RLS and reused across runs.
- `pnpm test:invariants` exercises generated inventory and purchasing command sequences; inspect its run journal at `/dev/invariants`.

## Repo Workflow

- Use worktrees for feature work.
- Keep mutations in API routes, not server actions.
- Do not import `db` directly in pages, components, or API routes; use DAL/query modules.
- Use HugeIcons only.
- Use semantic theme tokens only; do not hardcode Tailwind colors.
- Run `pnpm build` after changes to catch type errors.

## Where To Read Next

Start with `AGENTS.md` for repo-wide rules. It is symlinked to `CLAUDE.md` so
agent tools that look for either name load the same instructions. Then load the
relevant domain doc:

- `docs/worktrees.md`
- `docs/testing.md`
- `docs/architecture.md`
- `docs/database.md`
- `docs/api-patterns.md`
- `docs/ui-patterns.md`
- `docs/auth-team.md`
- `docs/production-ops.md`
- `docs/manufacturing.md`
- `docs/purchasing.md`
- `docs/stocktakes.md`
