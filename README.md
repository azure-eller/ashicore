# ERP

Inventory-first ERP rebuild for a small-scale MRP workflow.

This README is for coding agents and engineers working in the repo. It is a runbook, not a product overview.

## Current Scope

Active domains:

- inventory items, lots, stock movements, and stocktakes
- products and BOMs
- sales orders and customers
- purchase orders and suppliers
- manufacturing orders
- Better Auth org/team management

Explicitly out of scope today:

- multi-location inventory
- accounting, invoices, or payments
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

## Quick Start

1. Install dependencies:

```bash
pnpm install
```

2. Create the shared repo-root env:

```bash
cp .env.example .env.local
```

3. Fill the non-database values you need in `.env.local` like `BETTER_AUTH_SECRET`.

4. In each worktree, create that worktree's local DB and env:

```bash
pnpm db:local:setup
```

`pnpm db:local:setup` auto-starts the shared local Postgres container if needed.

Worktrees still fall back to the repo-root `.env.local` for shared settings, but they do not inherit `DATABASE_URL` or `DATABASE_URL_APP` from it.

5. Start the app:

```bash
pnpm dev
```

6. Validate changes:

```bash
pnpm build
pnpm lint
pnpm test
```

Playwright requires the dev server to be running first.

## Environment Variables

Required for normal app runtime:

- `DATABASE_URL_APP`: app runtime connection string for the restricted app role
- `DATABASE_URL`: owner connection string for migrations only

Required for auth / absolute URLs:

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL` or `NEXT_PUBLIC_APP_URL`
- `RESEND_API_KEY` and `EMAIL_FROM` in production for invites, password reset, and email verification
- `SENTRY_DSN` in production for server and edge Sentry events
- `NEXT_PUBLIC_SENTRY_DSN` in production for browser errors, tracing, and session replay

Optional:

- `BETTER_AUTH_ALLOWED_HOSTS`: comma-separated extra host patterns for LAN IPs or tunnel hosts. `localhost`, `127.0.0.1`, and `[::1]` on any port already work.
- `TEST_BASE_URL`: overrides Playwright base URL
- `PORT`: local fallback if you do not set an app URL
- `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_RELEASE`: enable source-map upload and release tagging for Sentry

## Database Notes

- `DATABASE_URL` is the owner connection. Use it for migration generation/application only via `pnpm db:generate` and `pnpm drizzle-kit migrate`.
- `DATABASE_URL_APP` is the app role. Use it for normal app runtime so RLS is actually exercised.
- Default local dev is one shared local Postgres instance plus one database per worktree.
- `pnpm db:local:setup` auto-starts local Postgres when needed, derives the database name from the current worktree folder, creates `app_user`, writes worktree-local DB URLs, and runs migrations.
- Run `pnpm worktree:cleanup <branch>` from the repo root after merge. It drops that branch's local DB, removes the worktree, deletes the local branch when possible, and stops Docker Postgres when no linked worktrees remain.
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
```

Focused tests:

```bash
pnpm test:inventory
pnpm test:sales
```

Database:

```bash
pnpm db:local:setup
pnpm worktree:cleanup <branch>
pnpm db:local:start   # optional manual control
pnpm db:local:stop
pnpm db:generate
pnpm drizzle-kit migrate
```

## Testing

- E2E only. App behavior is covered with Playwright.
- `test/global-setup.ts` provisions the test session and writes `test/.test-env.json`.
- Start `pnpm dev` before running Playwright locally.
- The test org is isolated by RLS and reused across runs.

## Repo Workflow

- Use worktrees for feature work.
- Keep mutations in API routes, not server actions.
- Do not import `db` directly in pages, components, or API routes; use DAL/query modules.
- Use HugeIcons only.
- Use semantic theme tokens only; do not hardcode Tailwind colors.
- Run `pnpm build` after changes to catch type errors.

## Where To Read Next

Start with `AGENTS.md` for repo-wide rules, then load the relevant domain doc:

- `docs/architecture.md`
- `docs/database.md`
- `docs/api-patterns.md`
- `docs/ui-patterns.md`
- `docs/auth-team.md`
- `docs/production-ops.md`
- `docs/manufacturing.md`
- `docs/purchasing.md`
- `docs/stocktakes.md`

For the current milestone sequence, see:

- `docs/small-scale-mrp-roadmap.md`
