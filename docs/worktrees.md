---
read_when:
  - Starting any code-changing work
  - Working alongside other agents in the repo
  - Cleaning up after a PR merges or closes
  - Coordinating local Postgres across worktrees
---

# Worktrees and multi-agent safety

## The rule

For code-changing work, never edit files in `/home/aeller/Projects/erp` (the repo root checkout) or on `main` unless the user explicitly asks for that. Always work in a dedicated git worktree.

- Do not reuse another active worktree unless the user explicitly points to it.
- Run `pnpm build`, `pnpm test`, and `pnpm lint` in the worktree that contains the change.

## Creating a worktree

For normal agent work, create the worktree from the repo root, enter it, and let
the workflow command prepare the environment:

```bash
git worktree add .worktrees/<branch-name> -b <branch-name>
cd .worktrees/<branch-name>
pnpm boot
```

`pnpm boot` installs dependencies when needed, starts local Postgres, creates the
worktree-local database, applies migrations, prepares the test session, and
starts a background dev server.

For live triage, use `pnpm sandbox [path]` instead of `pnpm boot`; sandbox runs
boot and then loads the Paonia production-copy review data.

Manual setup is still available for maintainers:

```bash
pnpm install
pnpm db:local:setup
pnpm dev
```

Worktrees fall back to the repo-root `.env.local` for shared settings (auth secrets, app URLs), but DB URLs must come from the worktree `.env.local` created by `pnpm db:local:setup`. This prevents a new worktree from silently pointing migrations at a shared remote Neon branch.

Local Postgres uses one shared server, but `pnpm db:local:setup` creates one database per worktree. Run `pnpm dev:seed-user` once per new worktree DB to load Paonia-style data into fake org `test-paonia-soil-co`.

Full DB workflow lives in `docs/database.md` under "Local Worktree Database Workflow."

## Local data and orgs

| Command | Data/session prepared | Use for |
|---------|-----------------------|---------|
| `pnpm boot` | Isolated `test-org` session and a background dev server | Feature work, scratch tests, fast/slow Playwright lanes |
| `pnpm servers` | All worktree dev servers, memory, URL, and idle age | Diagnose local resource use |
| `pnpm sandbox [path]` | Everything from `boot`, plus Paonia production-copy data in `test-paonia-soil-co` and an authenticated review browser | Live-data triage and UI screenshot review |
| `pnpm review <path> --slow <domains>` | Refreshes boot, seeds Paonia review data, validates, opens browser, and prepares the PR | Finishing feature or docs work |
| `pnpm dev:seed-user` | Manual local login data for `test@test.com` in `test-paonia-soil-co` | Maintainer/manual dev outside the agent workflow |

## Keeping worktrees current

Other branches merge while you work. Always rebase before key actions to avoid conflicts.

```bash
git fetch origin main && git rebase origin/main
```

Run this:

- Before your first commit in a worktree
- Before opening or pushing a PR

Never merge `main` into your branch — always rebase so history stays linear.

`pnpm lint` and `pnpm build` run `pnpm preflight`, which fetches `origin/main`
and fails if the current branch does not contain it. This check is intentionally
non-mutating beyond updating the local `origin/main` ref; it tells you to rebase
instead of rebasing for you.

The same preflight also fails local validation when:

- the repo root checkout is on anything other than `main`
- the current checkout is on `main`
- the checkout is detached

Use `ERP_ALLOW_UNSAFE_WORKTREE=1` only for explicit maintainer/root-maintenance
work, never as a way to get a feature branch through validation.

## Cleanup after merge or closure

After a PR merges or closes, agents MUST delete its Neon `preview/<git-branch>` branch, then run `pnpm worktree:cleanup <branch>` from the repo root to drop the local DB and remove the worktree. Delete only the preview matching that PR: never delete `production`, `vercel-dev`, a protected branch, or a preview for an open PR.

```bash
gh pr merge <pr> --merge
git push origin --delete <branch>
pnpm worktree:cleanup <branch>
```

Do not use `gh pr merge --delete-branch` from a feature worktree. Merge first, then delete the remote branch and run `pnpm worktree:cleanup <branch>` separately from the repo root.

For a closed, unmerged PR, confirm the PR is closed and its preview branch is not used by another open PR, then run `pnpm worktree:cleanup <branch> --force`; the command otherwise accepts only merged PRs.

`pnpm worktree:cleanup <branch>`:

- resolves the matching worktree from the branch name
- refuses to remove a dirty worktree
- drops that worktree's local database
- removes the worktree
- deletes the local branch when possible
- stops the shared Docker Postgres container when no linked worktrees remain

Local Postgres data persists across `pnpm db:local:stop`; no reseed is required after a normal restart.

## Multi-agent safety

When multiple agents may be working in the repo:

- Do not create, apply, or drop git stash.
- Scope commits to your own changes only.
- Do not run `git add .` or `git add -A` — stage specific files.
- Do not modify files outside the scope of your task.
- Assume other agents may be working in parallel — keep unrelated files untouched.

## Agent dev commands

- `pnpm boot` — idempotent: starts local Postgres, migrates, ensures the test-org session, starts the dev server on a free port in the background with a 4 GB JavaScript heap ceiling (bound to `0.0.0.0` so an Android emulator/device can reach it), and writes `.tmp/agent-session.json` (`port`, `baseUrl`, `dbName`, `branch`, `commit`, `worktreePath`, `testOrgId`, `reviewOrgSlug`, `devServerPid`, `devServerStartTime`, `updatedAt`). Re-running reuses a healthy server and restarts it if the recorded commit/branch is stale. A repo-wide reaper stops servers after 30 minutes without boot, Playwright, or review activity; those workflows transparently restart a stopped server. `ERP_DEV_IDLE_MINUTES` sets the timeout when a new reaper starts.
- `pnpm servers` — lists every recorded worktree server with status, process-group memory, URL, and idle age. It also performs an immediate idle-server sweep.
- `pnpm review <path> --slow <domains> [--validate build,lint,fast:sales] [--inventory] [--cached] [--domain <d>] [--docs-only]` — phased: refresh the dev server if stale (re-runs `pnpm boot`) → seed review org (live snapshot; fail-loud if `.vercel/.env.production.local` is missing, `--cached` reuses the last export and prints its provenance) → run declared validation → open the authenticated review browser at `<path>` → require a clean tree, then push + open the PR ready with a validation block → set `ci:slow:*` then `ci:ready`. Validation failure or a dirty tree stops at the PR step; data + browser are still prepared. A missing slow label is fatal unless `--docs-only` (→ `ci:slow:none`); path inference never decides labels.
- `pnpm sandbox [path] [--fresh] [--cached]` — the **triage** start (vs `boot`'s clean start): runs `boot`, loads the live Paonia production copy into the review org (`test-paonia-soil-co`), and opens the authenticated review browser at `<path>` (default `/`). Idempotent — if the review org is already seeded it **preserves** that data and only refreshes the session; `--fresh` re-imports current production, `--cached` reuses the last export. Use it to browse real data, point the agent at fixes, and watch them hot-reload. Fixes land through the normal `pnpm review` finish — sandbox adds no PR path of its own.
- Teardown: keep the worktree, DB, and dev-server session until the PR merges or closes; the running server may be reaped while idle. `pnpm worktree:cleanup <branch>` refuses unless the PR is `MERGED` (use `--force` after confirming an unmerged PR is closed).
