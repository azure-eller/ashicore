---
read_when:
  - Starting any code-changing work
  - Working alongside other agents in the repo
  - Cleaning up after a PR merges
  - Coordinating local Postgres across worktrees
---

# Worktrees and multi-agent safety

## The rule

For code-changing work, never edit files in `/home/aeller/Projects/erp` (the repo root checkout) or on `main` unless the user explicitly asks for that. Always work in a dedicated git worktree.

- Do not reuse another active worktree unless the user explicitly points to it.
- Run `pnpm build`, `pnpm test`, and `pnpm lint` in the worktree that contains the change.

## Creating a worktree

```bash
git worktree add .worktrees/<branch-name> -b <branch-name>
cd .worktrees/<branch-name>
pnpm install
pnpm db:local:setup
```

Worktrees fall back to the repo-root `.env.local` for shared settings (auth secrets, app URLs), but DB URLs must come from the worktree `.env.local` created by `pnpm db:local:setup`. This prevents a new worktree from silently pointing migrations at a shared remote Neon branch.

Local Postgres uses one shared server, but `pnpm db:local:setup` creates one database per worktree. Run `pnpm dev:seed-user` once per new worktree DB to load Paonia-style data into fake org `test-paonia-soil-co`.

Full DB workflow lives in `docs/database.md` under "Local Worktree Database Workflow."

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

## Cleanup after merge

After a PR merges, agents MUST run `pnpm worktree:cleanup <branch>` from the repo root to drop the local DB and remove the worktree.

```bash
gh pr merge <pr> --merge
git push origin --delete <branch>
pnpm worktree:cleanup <branch>
```

Do not use `gh pr merge --delete-branch` from a feature worktree. Merge first, then delete the remote branch and run `pnpm worktree:cleanup <branch>` separately from the repo root.

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
