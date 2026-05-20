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

Tests follow **serial domain stories** mirroring real user workflows. Keep each file self-contained so inventory and sales can run together or in isolation.

The `db` fixture uses the app role with RLS — same security path as the real app. After form submission, query the database directly via that fixture to verify the row.

## Lanes

- **Fast specs** live in `test/e2e/fast/` and cover browser write paths only: fill form, submit, minimal success UI, DB assertions.
- **Slow specs** live in `test/e2e/slow/` and stay serial, operational stories: create, edit, transition, reload, and verify UI/API/DB/storage effects where relevant.
- **Auth regressions** live in `test/e2e/auth-security.spec.ts` and run separately from the fast/slow domain split.
- Keep slow specs rooted in normal operations. Only include guards/errors when they arise inside a realistic workflow.
- Use `test/e2e/slow/customer-crm.spec.ts` as the breadth model for slow stories.
- Do not add new one-off story suites outside `fast/`, `slow/`, or `auth-security.spec.ts`.

## Which lane to run

| Change scope | Run locally |
|--------------|-------------|
| Narrow domain change | `pnpm build`, `pnpm lint`, `pnpm test:fast:<domain>` |
| Shared / cross-domain change | `pnpm build`, `pnpm lint`, `pnpm test:fast` |
| Deep change in one domain | Add `pnpm test:slow:<domain>` |
| Auth, invites, team access | `pnpm test:slow:auth` (covers `auth-security.spec.ts` + `team-management.spec.ts`) |
| Stock mutations, reservations, expected supply, inventory projections, inventory-affecting API routes | Affected slow spec(s), then `pnpm verify:inventory` |

Domain slow lanes may include multiple story files: sales includes order, CRM, and partial-shipment stories; inventory includes item-form, cost-basis, and visibility stories.

Local fast lanes default to 2 Playwright workers. CI overrides with `PLAYWRIGHT_FAST_WORKERS=4`.

Do not run the whole slow lane locally unless the change is cross-domain or explicitly needs broad workflow verification.

`pnpm verify:inventory` is the standard inventory integrity workflow: kernel grep guards + projection diff for the current Playwright test org.

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
- `test/e2e/fast/` — fast write-path smoke specs
- `test/e2e/slow/` — serial operational stories by domain
- `test/e2e/auth-security.spec.ts` — auth and permission regressions
- `test/global-setup.ts` — creates test user/org/unit, writes `.test-env.json`
- `test/helpers/api.ts` — authenticated fetch helpers
