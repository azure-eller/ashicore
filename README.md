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

2. Create local env:

```bash
cp .env.example .env.local
```

3. Fill the required values in `.env.local`.

4. Start the app:

```bash
pnpm dev
```

5. Validate changes:

```bash
pnpm build
pnpm lint
pnpm test
```

Playwright requires the dev server to be running first.

## Environment Variables

Required for normal app runtime:

- `DATABASE_URL_APP`: app runtime connection string for the restricted app role
- `DATABASE_URL`: owner connection string for migrations and fallback local runtime

Required for auth / absolute URLs:

- `BETTER_AUTH_URL` or `NEXT_PUBLIC_APP_URL`

Optional:

- `RESEND_API_KEY`: email delivery for team invites
- `EMAIL_FROM`: sender address for invite emails
- `TEST_BASE_URL`: overrides Playwright base URL
- `PORT`: local fallback if you do not set an app URL

## Database Notes

- `DATABASE_URL` is the owner connection. Use it for `drizzle-kit generate` and `drizzle-kit migrate`.
- `DATABASE_URL_APP` is the app role. The app should use this in normal runtime so RLS is actually exercised.
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
pnpm drizzle-kit generate
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
- `docs/manufacturing.md`
- `docs/purchasing.md`
- `docs/stocktakes.md`

For the current milestone sequence, see:

- `docs/small-scale-mrp-roadmap.md`
