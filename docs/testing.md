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
- **Auth regressions** live in `test/e2e/auth-security.spec.ts` and run separately from the fast/slow domain split.
- Keep slow specs rooted in normal operations. Only include guards/errors when they arise inside a realistic workflow.
- Slow specs are not bug archives. A slow spec must be a realistic operational story that a small manufacturer would recognize.
- Do not add new one-off story suites outside `fast/`, `slow/`, or `auth-security.spec.ts`.

## Which lane to run

| Change scope | Run locally |
|--------------|-------------|
| Narrow domain change | `pnpm build`, `pnpm lint`, `pnpm test:fast:<domain>` |
| Shared / cross-domain change | `pnpm build`, `pnpm lint`, `pnpm test:fast` |
| Deep change in one domain | Add `pnpm test:slow:<domain>` |
| Auth, invites, team access | `pnpm test:slow:auth` (covers `auth-security.spec.ts` + `team-management.spec.ts`) |
| Stock mutations, reservations, expected supply, inventory projections, inventory-affecting API routes | Affected slow spec(s), then `pnpm verify:inventory` |

Domain slow lanes may include multiple story files: sales includes order and CRM stories; inventory includes item-form, cost-basis, and visibility stories. Stocktake is folded into `test:fast:inventory`.

Local fast lanes default to 2 Playwright workers. CI overrides with `PLAYWRIGHT_FAST_WORKERS=4`.

Do not run the whole slow lane locally unless the change is cross-domain or explicitly needs broad workflow verification.

`pnpm verify:inventory` is the standard inventory integrity workflow: kernel grep guards + projection diff for the current Playwright test org.

## Fast Test Guardrails

Fast tests are mutation-seam heartbeats. Each test must prove one business invariant across UI/API/database boundaries. The one exception is `auth-org-context.spec.ts`, which proves authenticated active-org app/API access.

- Maximum fast spec files: 8. Target total `test()` blocks: 10-15.
- A fast spec file must be listed in `test/e2e/fast/FAST_TEST_SEAMS.md`.
- If the seam cannot be stated in one sentence, delete the test or move/fold it out of fast.
- Class-level invariants may survive only inside an existing heartbeat seam; they do not justify new fast files.
- Fast tests may use API/DB setup to reach the seam quickly. Do not create prerequisites through UI unless prerequisite creation is the seam.
- Do not assert incidental UI details such as toast copy, menu text, layout, sort order, tab defaults, list breadth, button wording, or CSS state unless that UI behavior is the seam.
- No bug-souvenir tests. Historical one-off regressions are deleted unless they represent a compact class-level invariant tied to a listed seam.

Not fast in this pass: Xero OAuth/push/retry/email/accounting sync, detailed FEFO/lot-expiry, detailed cost roll-up, catalog/item-card autosave, long manufacturing execution workflows, and full planning/allocation operational stories.

## Slow Test Guardrails

Slow tests are operating stories, not bug archives. A slow spec must be a realistic workflow a small manufacturer would recognize; edge cases belong only when they naturally occur inside that story.

- If the story cannot be stated in one sentence, delete it or convert the invariant to non-browser verification.
- Do not move tests to slow just because deletion feels risky.
- Prefer flows like create, edit, submit, receive, confirm, ship, release, complete, count, and reconcile.
- Use API/DB helpers for prerequisites unless creating the prerequisite is part of the story.
- Avoid pure API-only slow stories unless the contract is intentionally headless or mobile-facing.
- Keep customer, cost, planning, and stocktake stories bounded by the active slow-suite audit in `docs/slow-suite-audit.md`.

## Writing tests

- `test.describe.configure({ mode: "serial" })` for tests that depend on each other.
- Share data between tests via variables at the describe level, not helper functions.
- All created items use `Date.now()` timestamps in names to avoid collisions.
- Dev server must be running (`pnpm dev`) before `pnpm test`.
- Canonical local login: `test@test.com` / `TestPassword123!`. `pnpm dev:seed-user` keeps this user on fake org `test-paonia-soil-co` and loads Paonia-style data.
- Playwright global setup creates isolated generated test data in `test-org`.

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
- `ci:slow:inventory`
- `ci:slow:purchasing`
- `ci:slow:manufacturing`
- `ci:slow:stocktake`
- `ci:slow:auth`
- `ci:slow:all` — shared DB/schema/DAL/API/test-infra changes (full slow directory + auth regressions)
- `ci:slow:none` — docs/CI-only changes; cannot be combined with other slow labels

Missing labels fail the slow selector only after `ci:ready` is present.

Add the slow-selection label **before** `ci:ready`. Add `ci:ready` only after local validation is complete and documented in the PR body or a PR comment. If you push another commit after final CI, remove `ci:ready`, rerun local validation, then re-add it.

Failed scheduled slow runs open/update an investigation PR, comment with run details, and dispatch Claude Code with the run and artifact links. Treat those PRs as fix branches, not merge-ready reports.

## Key files

- `test/e2e/fixtures.ts` — custom `test` with `db` fixture (Drizzle + Neon + RLS)
- `test/e2e/fast/` — heartbeat mutation-seam specs
- `test/e2e/slow/` — serial operational stories by domain
- `test/e2e/auth-security.spec.ts` — auth and permission regressions
- `test/global-setup.ts` — creates test user/org/unit, writes `.test-env.json`
- `test/helpers/api.ts` — authenticated fetch helpers
