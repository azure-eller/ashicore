---
name: feature-workflow
description: >-
  The end-to-end loop for planning and implementing a feature, change, bugfix, or
  refactor in this ERP repo. Use whenever the user wants to build or change
  something non-trivial — "add X", "implement Y", "fix the Z bug", "refactor W",
  "let's build...", or hands you a spec/ticket/plan. Covers planning, the worktree
  dev env (pnpm boot), scratch-first TDD, and landing via pnpm review. Do NOT use
  for quick live tweaks against production data — that is the sandbox-workflow
  skill.
---

The spine for the classic build loop. It sequences the generic planning/TDD
skills and slots in this repo's commands. The rules live in CLAUDE.md and the
detail in `docs/testing.md` / `docs/worktrees.md` — follow those; don't restate
them here. Read CLAUDE.md's hard rules first (worktrees, DAL, migrations,
inventory kernel, mobile contract); they override anything below.

## The loop

1. **Understand & plan.** If the goal is fuzzy, use `superpowers:brainstorming`
   to pin down intent, then `superpowers:writing-plans` for a step plan. A clear,
   small change can skip to a short inline plan.
2. **Start the dev env.** In a worktree, run `pnpm boot` — one command that starts
   the local DB, migrates, backgrounds the dev server, and writes
   `.tmp/agent-session.json`. Don't hand-roll the DB/server/seed steps.
3. **Red.** Write an in-depth throwaway suite in `test/e2e/scratch/` asserting the
   intended UI + DB outcomes, then `pnpm test:scratch` → it should fail. (Scratch
   specs skip login; the fixture injects the session.)
4. **Green.** Implement with `superpowers:test-driven-development`, iterating
   against `pnpm test:scratch` rather than a browser. For independent sub-tasks,
   drive with `superpowers:subagent-driven-development`.
5. **Distill.** Fold only the essential invariant into the fast/slow lanes per the
   guardrails in `docs/testing.md`, then delete the scratch suite. The PR must not
   carry disposable specs.
6. **Land.** Run `pnpm review <path> --slow <domains>` — it validates, seeds the
   production copy, opens the authenticated review browser, and opens the PR.
   Keep the worktree/DB/dev server until the PR merges.
