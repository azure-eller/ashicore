## Project

Multi-module ERP: inventory, manufacturing, sales, purchasing.
Android companion app at `~/Projects/erp-android`.
Public marketing/docs live in Astro at `apps/www` and deploy to Vercel project `www`; the authenticated Next.js app deploys to Vercel project `erp`.

## Stack

Next.js (App Router), Drizzle ORM, Neon Postgres, shadcn/ui (radix-nova / stone), TanStack Query, react-hook-form, Zod, Better Auth, pnpm.

## Principles

**1. Build for decades.** This codebase will outlive the request. Pick the right architecture even when a hack would close the ticket. Fix root causes, not symptoms. Temporary workarounds tend to survive. If one is truly necessary, name it, isolate it, and track its removal — otherwise fix the root cause.

**2. Less is the default.** Less code, less UI text, fewer abstractions, fewer comments, fewer features. Do what was asked, not what's adjacent. If you can remove it without losing meaning, remove it.

**3. Reuse before you create.** Before writing a helper, component, validator, data access pattern, business rule, or workflow, check what already exists. New patterns tax every future agent. Business logic belongs in the domain layer (DAL/API), not in pages or components.

**4. Verify with reality.** Types compile and tests can pass while the feature is broken. Before claiming done, build, lint, test — and for UI changes, use the feature in a browser.

**5. Caution near destruction and shared state.** Anything that could lose work, mutate shared rows, bypass isolation, or affect other agents needs care. Ask before destructive, irreversible, or scope-expanding actions. Never bypass a safety check to make a problem go away.

## Hard rules

These are non-negotiable repo rules. They are repeated here because violating them is expensive, even when the principles already imply them.

- **Start in a workflow.** Before touching code, pick a mode and follow its skill: **feature-workflow** (build/change/fix, or working from a spec or ticket — starts with `pnpm boot`) or **sandbox-workflow** (live triage on a production-copy: tweak a page, reproduce an issue, "see it change as I go" — starts with `pnpm sandbox`, never `pnpm boot`, which has an empty org with no data). If the mode is genuinely ambiguous, ask first. **One mode per session: once started, don't switch or open a second worktree/dev env** — make any new change in the worktree you're already in and land it with `pnpm review` (need live data mid-feature? run `pnpm sandbox` in place).
- **Worktrees for code changes.** Never edit on `main` or in the repo root checkout unless explicitly asked. `pnpm lint` and `pnpm build` run a preflight that fetches `origin/main`, blocks stale branches, blocks local `main`, and blocks a repo-root checkout that is not `main`. Keep the worktree/DB/dev server until the PR merges; clean up only after.
- **DAL only.** Never import `db` directly in pages, components, or API routes.
- **RLS on new tables.** New org-scoped tables need `.enableRLS()` + org-isolation `pgPolicy` in Drizzle, plus `FORCE ROW LEVEL SECURITY` in migration SQL.
- **Migrations.** Use `pnpm db:generate` + `pnpm drizzle-kit migrate`. Never use `drizzle push`. Generate migrations from fresh `origin/main`.
- **API routes for mutations.** No server actions.
- **Inventory kernel.** Stock, lots, costs, commitments, expected supply, dispositions, and allocations must go through canonical inventory/domain paths. Never "just update a quantity." Lot-untracked items still use internal lots for kernel storage, costing, and audit.
- **Mobile contract.** The Android app (`~/Projects/erp-android`) consumes this app's REST API and mirrors its behavior — assume any change here can reach it. Before finishing work that could affect what the app sees or relies on, spawn a subagent to assess mobile impact: it MUST read `~/Projects/erp-android/CLAUDE.md` first (sibling-repo memory does not auto-load), then trace the affected surface in that repo. Judge by whether the app's assumptions could have shifted, not by which files you changed.
- **Icons.** HugeIcons only. Never Lucide.
- **Design tokens.** Use shadcn semantic color classes and app raw tokens for spacing/sizing/type/radius. App-wide runtime token values live only in `app/styles/theme.css`; docs explain intent and must not duplicate raw token values. Never hardcode Tailwind colors.
- **Testing model.** Playwright is the app test path with real DB assertions. No bug-souvenir tests. Fast tests must protect a listed core mutation seam and avoid incidental UI assertions. Slow tests are operating stories, not bug archives; edge cases belong only when they naturally occur inside that story. Do not add Vitest, unit tests, or mocking frameworks unless explicitly asked. Scratch-first: drive each change with a throwaway suite in `test/e2e/scratch/` (red→green), distill only the essential invariant into fast/slow, delete the scratch suite before the PR. UI-affecting changes also get a throwaway Paonia screenshot pass per `docs/ui-review-checklist.md`, then delete the scratch spec before the PR.
- **No `git add .` / `git add -A`.** Stage specific files.
- **Never `--no-verify`.** Never bypass hooks or safety checks without explicit ask.

## Commands

- `pnpm dev` — start dev server
- `pnpm boot` — start/resume worktree dev env (DB, migrate, session, background server)
- `pnpm test:scratch` — run the throwaway per-change scratch suite
- `pnpm review <path> --slow <domains>` — validate, seed review data, open browser, open PR
- `pnpm sandbox [path]` — triage start: dev server + live Paonia production copy + authenticated browser
- `pnpm build` — production build (catch type errors)
- `pnpm lint` — ESLint
- `pnpm preflight` — local worktree safety check; fetches `origin/main` and fails on stale/non-worktree/main checkouts
- `pnpm test` / `pnpm test:fast` — heartbeat fast Playwright lane (dev server must be running)
- `pnpm test:fast:<domain>` — heartbeat domain lanes (`sales`, `inventory`, `purchasing`, `manufacturing`, `planning`)
- `pnpm test:slow:<domain>` — slow domain lanes (`sales`, `purchasing`, `manufacturing`, `planning`, `stocktake`, `auth`)
- `pnpm db:local:setup` — set up this worktree's local DB and run migrations
- `pnpm dev:seed-user` — seed canonical test user and Paonia-style data
- `pnpm db:generate` — generate migration
- `pnpm drizzle-kit migrate` — apply migrations
- `pnpm verify:inventory` — kernel grep guards + projection diff
- `pnpm worktree:cleanup <branch>` — drop worktree DB and remove worktree

## Documentation

This file is a constitution + map. Deep reference lives in `docs/` — read the relevant doc before working in that area.

**Adding new rules:** put domain-specific rules in the matching leaf doc. Add to this file only when a rule is truly cross-cutting and load-bearing.

| Task area | Read |
|-----------|------|
| Forms / form fields | `docs/references/field-example.md`, `docs/references/react-hook-form-example.md` |
| Reusable components / before creating UI | `docs/design/components.md` |
| UI, components, layout | `docs/design/patterns.md`, `docs/ui-patterns.md` |
| UI screenshot review | `docs/ui-review-checklist.md` |
| Design system (tokens, color, type, density) | `docs/design/README.md` |
| API routes, mutations | `docs/api-patterns.md` |
| Schema, migrations, DAL, roles | `docs/database.md` |
| Testing lanes, CI labels, fixtures | `docs/testing.md` |
| Worktrees, multi-agent safety | `docs/worktrees.md` |
| Feature planning | `docs/architecture.md` |
| Linear workflow / PR tracking | `docs/linear-workflow.md` |
| ERP agent reactivation / overhead | `docs/erp-agent.md` |
| MRP-lite planning | `docs/planning.md` |
| Auth, roles, team invites | `docs/auth-team.md` |
| Production launch, auth protection, observability | `docs/production-ops.md` |
| Xero App Store / partner readiness | `docs/xero-partner-readiness.md` |
| Xero security evidence / key rotation | `docs/xero-security-evidence.md` |
| Manufacturing orders | `docs/manufacturing.md` |
| Notifications, push, FCM | `docs/notifications.md` |
| Sales orders, customers, shipping | `docs/sales.md` |
| Purchasing, suppliers, receiving | `docs/purchasing.md` |
| Stocktakes, reconciliation | `docs/stocktakes.md` |
| Xero integration, OAuth, push retry | `docs/xero.md` |

## PR is done when

1. `pnpm build`, `pnpm lint`, and relevant fast/slow Playwright lanes pass
2. Inventory-affecting changes also pass `pnpm verify:inventory`
3. PR body records the local validation that ran
4. Correct `ci:slow:*` label is set, then `ci:ready` is added last
5. PR is opened ready for review, not draft
6. UI changes are left running on a dev server seeded with Paonia data, opened to a page that shows the change
