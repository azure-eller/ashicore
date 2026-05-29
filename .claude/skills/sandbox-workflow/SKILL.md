---
name: sandbox-workflow
description: >-
  The triage loop for making live changes against a copy of current production
  (Paonia Soil Co.) data. Use whenever the user wants to poke at real data, make
  small UI fixes, "see it change as you go", reproduce or triage a production
  issue, or iterate on look-and-feel — e.g. "spin up the real data and let's
  fix...", "tweak this page", "why does X look wrong with the actual orders",
  "load production and walk through it with me". Do NOT use for building a planned
  feature from scratch — that is the feature-workflow skill.
---

The spine for the triage loop, where you and the user iterate live on a
production-copy of the data. Rules live in CLAUDE.md; command detail in
`docs/worktrees.md` — follow those, don't restate them.

## The loop

1. **Start the sandbox.** In a worktree, run `pnpm sandbox [path]` — boots the dev
   server, loads a live copy of Paonia production into the review org
   (`test-paonia-soil-co`), and opens the authenticated browser at `path`.
   Re-running preserves whatever state you built up (it won't re-import);
   `--fresh` re-imports current production, `--cached` reuses the last export.
2. **Fix and watch.** The user points at problems; make the code change. The dev
   server hot-reloads, so each fix shows up live in the open browser. Confirm
   visually with the user before moving on.
3. **(Optional) lock it in.** If a fix deserves a regression test, write a
   throwaway `test/e2e/scratch/` spec and distill the essential invariant per
   `docs/testing.md` — but here the live browser is the primary check.
4. **Land.** When the fixes are ready, commit and run
   `pnpm review <path> --slow <domains>` to validate and open the PR — the same
   finish as the feature workflow. Keep the worktree/DB/dev server until it merges.
