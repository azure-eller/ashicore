---
read_when:
  - Writing or modifying Playwright tests
  - Deciding which test lane to run before a commit
  - Setting CI slow labels on a PR
  - Investigating test infrastructure or fixtures
---

# Testing

## Model

**Playwright e2e only** — no Vitest, no unit tests, no mocks. `e2e` means Playwright; `fast` and `slow` are the lanes.

Fast tests are heartbeat tests. Slow tests follow **operating stories** mirroring real user workflows. Keep each file self-contained so inventory and sales can run together or in isolation.

The `db` fixture uses the app role with RLS — same security path as the real app. After the seam action, query the database directly via that fixture to verify the resulting state.

## Lanes

- **Fast specs** live in `test/e2e/fast/` and protect core mutation seams. Each fast spec must map to `test/e2e/fast/FAST_TEST_SEAMS.md`.
- **Slow specs** live in `test/e2e/slow/` and stay serial, operational stories: create, edit, transition, reload, and verify UI/API/DB/storage effects where relevant.
- **Auth/security access stories** live in `test/e2e/auth-security.spec.ts` and `test/e2e/team-access.spec.ts`; they run separately from the fast/slow domain split.
- Keep slow specs rooted in normal operations. Only include guards/errors when they arise inside a realistic workflow.
- Slow specs are not bug archives. A slow spec must be a realistic operational story that a small manufacturer would recognize.
- Do not add new one-off story suites outside `fast/`, `slow/`, or the auth/security access lane.
- **Invariants harness** (`pnpm test:invariants`) is a stateful property-based lane in `test/e2e/invariants.spec.ts`: generated command sequences exercise the public API, a spec-derived model supplies the oracle, and org-wide invariant sweeps run after every command. It currently covers the inventory quantity spine and a focused purchasing lifecycle slice.

## Which lane to run

| Change scope | Run locally |
|--------------|-------------|
| Narrow domain change | `pnpm build`, `pnpm lint`, `pnpm test:fast:<domain>` |
| Shared / cross-domain change | `pnpm build`, `pnpm lint`, `pnpm test:fast` |
| Deep change in one domain | Add `pnpm test:slow:<domain>` |
| Auth, invites, team access | `pnpm test:slow:auth` (covers `auth-security.spec.ts` + `team-access.spec.ts`) |
| Stock mutations, demand, expected supply, inventory projections, inventory-affecting API routes | Affected slow spec(s), then `pnpm verify:inventory` |
| Inventory quantity laws or a command already modelled by the invariants harness | Add `pnpm test:invariants` |

Slow lanes are one canonical story file per operating workflow. There is no generic inventory slow lane; route inventory-affecting PRs by workflow:

- receiving / expected supply → `pnpm test:slow:purchasing`
- manufacturing stock or output cost → `pnpm test:slow:manufacturing`
- stocktake / reconciliation → `pnpm test:slow:stocktake`
- planning → `pnpm test:slow:planning`
- sales shipment / consumption → `pnpm test:slow:sales`
- kernel / projection / math → `pnpm test:fast:inventory`, `pnpm verify:inventory`, and the relevant story lane

Local fast lanes default to 2 Playwright workers. CI overrides with `PLAYWRIGHT_FAST_WORKERS=4`.

Do not run the whole slow lane locally unless the change is cross-domain or explicitly needs broad workflow verification.

`pnpm verify:inventory` is the standard inventory integrity workflow: kernel grep guards, projection diff, and planning-reference integrity checks for the current Playwright test org. The projection diff compares item balances to current lot balances plus active demand/expected summaries, while lot and reference drift remain ledger diagnostics. The planning checks fail on negative, orphaned, inactive, or over-target demand/expected rows even when projection totals otherwise balance.

## Invariants Harness

Start the dev server and initialise the Playwright session before running `pnpm test:invariants`. The harness wipes its test org between generated sequences and holds a database advisory lock for the whole suite, so only one invariants run may use a database at a time. It does not replace the fast, slow, or `verify:inventory` lanes.

Each run appends `test/e2e/invariants-journal.jsonl`, rewrites `test/e2e/invariants-spec.json`, and prints the observatory URL. Open `/dev/invariants` on the dev server to inspect the current specification, command coverage, situations reached, invariant sweeps, and any shrunk counterexample. The route and generated artifacts are development-only; the route returns 404 in production and before an artifact exists.

Replay a failed journal entry with all three values recorded on that entry:

```bash
INVARIANTS_SEED=<seed> \
INVARIANTS_PATH='<path>' \
INVARIANTS_PROPERTY=<integration-or-purchasing> \
pnpm test:invariants
```

Available tuning variables are:

- `INVARIANTS_NUM_RUNS` — generated sequences per property
- `INVARIANTS_MAX_COMMANDS` — maximum commands per sequence
- `INVARIANTS_TIMEOUT_MS` — timeout for each property
- `INVARIANTS_VERBOSE=1` — print each generated sequence

Lower budgets may fail the binding coverage floors even when no business invariant is violated. Model semantics changes must follow **THE PROTOCOL** in the spec file header: author the model proposal blind to application code, triage every divergence explicitly, and park unresolved commands with a reason. When the I3 liveness sweep SQL changes, rerun `test/e2e/validate-i3-liveness.sh` and replace `test/e2e/invariants-i3-fault-validation.md`; the script requires the boot-created test environment and owner database URL.

## Fast Test Guardrails

Fast tests are mutation-seam heartbeats. Each test must prove one business invariant across UI/API/database boundaries. The one exception is `auth-org-context.spec.ts`, which proves authenticated active-org app/API access.

- Maximum fast spec files: 8. Target total `test()` blocks: 10-15.
- A fast spec file must be listed in `test/e2e/fast/FAST_TEST_SEAMS.md`.
- If the seam cannot be stated in one sentence, delete the test or move/fold it out of fast.
- Class-level invariants may survive only inside an existing heartbeat seam; they do not justify new fast files.
- Fast tests may use API/DB setup to reach the seam quickly. Do not create prerequisites through UI unless prerequisite creation is the seam.
- Do not assert incidental UI details such as toast copy, menu text, layout, sort order, tab defaults, list breadth, button wording, or CSS state unless that UI behavior is the seam.
- No bug-souvenir tests. Historical one-off regressions are deleted unless they represent a compact class-level invariant tied to a listed seam.

Not fast in this pass: live Xero OAuth/network push/retry/email/accounting sync, detailed FEFO/lot-expiry, detailed cost roll-up, long manufacturing execution workflows, and full planning/allocation operational stories.

## Slow Test Guardrails

Slow tests are operating stories, not bug archives. A slow spec must be a realistic workflow a small manufacturer would recognize; edge cases belong only when they naturally occur inside that story.

- If the story cannot be stated in one sentence, delete it or convert the invariant to non-browser verification.
- Do not move tests to slow just because deletion feels risky.
- Prefer flows like create, edit, submit, receive, confirm, ship, release, complete, count, and reconcile.
- Use API/DB helpers for prerequisites unless creating the prerequisite is part of the story.
- Use UI where it proves workflow usability or persistence; use API helpers for setup and mutation seams when UI breadth would make the story brittle.
- Assert API responses on important mutations and prove business state with DB/domain/read-model evidence.
- Every slow spec must be listed in `test/e2e/slow/SLOW_TEST_STORIES.md`.
- Keep customer, cost, planning, and stocktake stories bounded by the active slow-suite registry `test/e2e/slow/SLOW_TEST_STORIES.md`.

## Writing tests

- `test.describe.configure({ mode: "serial" })` for tests that depend on each other.
- Share data between tests via variables at the describe level, not helper functions.
- All created items use `Date.now()` timestamps in names to avoid collisions.
- Dev server must be running (`pnpm dev`) before `pnpm test`.
- Canonical local login: `test@test.com` / `TestPassword123!`. `pnpm dev:seed-user` keeps this user on fake org `test-paonia-soil-co` and loads Paonia-style data.
- Playwright global setup creates isolated generated test data in `test-org`.

## Scratch UI Screenshot Review

UI screenshot review is a development-time scratch loop for UI-affecting changes,
not a permanent fast/slow lane and not a CI gate. Write a throwaway spec in
`test/e2e/scratch/` using `reviewTest`, drive the changed UI through its
important states against the Paonia review session from `pnpm sandbox` or
`pnpm review`, call `captureForReview`, inspect the PNGs in `.tmp/ui-shots/`,
fix what the screenshots reveal, rerun, and delete the scratch spec before the
PR. The rubric and copyable template live in `docs/ui-review-checklist.md`.

### Playwright email outbox

Email assertions must force outbox mode with the runtime flag file, not only process env. The dev server may inherit repo-root Resend vars before tests start.

```ts
fs.writeFileSync(EMAIL_OUTBOX_MODE_FLAG, "1")
if (!senderConfig || (await shouldWriteEmailOutbox())) await writeEmailOutbox(email)
```

## CI labels and the `ci:ready` workflow

GitHub CI is a final clean-room gate, not the development test loop. Run the required local checks, record results in the PR, then add `ci:ready` only when the PR is ready for final verification.

PRs must have exactly the needed slow labels:

- `ci:slow:sales`
- `ci:slow:purchasing`
- `ci:slow:manufacturing`
- `ci:slow:planning`
- `ci:slow:stocktake`
- `ci:slow:auth`
- `ci:slow:all` — shared DB/schema/DAL/API/test-infra changes (full slow directory + auth regressions)
- `ci:slow:none` — docs/CI-only changes; cannot be combined with other slow labels

Missing labels fail the slow selector only after `ci:ready` is present.

Add the slow-selection label **before** `ci:ready`. Add `ci:ready` only after local validation is complete and documented in the PR body or a PR comment. If you push another commit after final CI, remove `ci:ready`, rerun local validation, then re-add it.

Non-draft pull requests run `.github/workflows/codex-code-review.yml`, which uses the official read-only Codex GitHub Action and updates one review comment per PR.

Failed scheduled slow runs open/update an investigation PR, comment with run details, and hand the run and artifact links to Codex via `@codex`. Treat those PRs as fix branches, not merge-ready reports.

## Key files

- `test/e2e/fixtures.ts` — custom `test` with `db` fixture (Drizzle + Neon + RLS), plus `reviewTest` for Paonia-backed scratch UI screenshot specs
- `test/helpers/evidence-screenshots.ts` — `captureForReview` viewport/element screenshot helper
- `test/e2e/fast/` — heartbeat mutation-seam specs
- `test/e2e/slow/` — serial operational stories by domain
- `test/e2e/slow/SLOW_TEST_STORIES.md` — allowed slow-story registry
- `test/e2e/auth-security.spec.ts` — auth and permission regressions
- `test/e2e/team-access.spec.ts` — compact team invite and access-boundary stories
- `test/e2e/invariants.spec.ts` — stateful model, generated commands, specification, and invariant sweeps
- `test/e2e/invariants-observatory.html` — development-only run and specification viewer served at `/dev/invariants`
- `test/e2e/invariants-i3-fault-validation.md` — retained fault-injection evidence for the I3 liveness sweep
- `test/e2e/validate-i3-liveness.sh` — destructive-in-its-test-org fault validator for the I3 liveness sweep
- `test/global-setup.ts` — creates test user/org/unit, writes `.test-env.json`
- `test/helpers/api.ts` — authenticated fetch helpers

## Agent dev loop

The step-by-step loop lives in the workflow skills, which fire on intent: the
`feature-workflow` skill (plan → boot → scratch-first TDD → distill → review) and
the `sandbox-workflow` skill (triage against a production copy). This doc is the
test-guardrail reference those skills point back to.

**Orgs:** scratch/fast/slow run against the isolated `test-org` (session in `test/.test-env.json`). The exception is throwaway UI screenshot review specs, which import `reviewTest` and use the Paonia review session in `test/.review-env.json`. `pnpm review` / `pnpm sandbox` seed the live Paonia snapshot into `test-paonia-soil-co`; permanent automated tests never depend on snapshot breadth, and agents never run a destructive reseed against `test-org`.
