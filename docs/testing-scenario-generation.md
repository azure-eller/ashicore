---
read_when:
  - planning Playwright coverage
  - changing e2e scripts or CI triggers
  - splitting tests between fast and slow lanes
---

# Testing Scenario Generation

## Core split

- `test/e2e/fast/`: browser write-path smoke tests
- `test/e2e/slow/`: serial operational stories
- `test/e2e/auth-security.spec.ts`: focused auth/security regressions
- `e2e` means Playwright in this repo; `fast` and `slow` are the lanes.

## Fast lane rules

- Use the real browser form for the write boundary under test.
- Stop after submit, one success signal, and DB assertions.
- Use API helpers for setup that is not the subject of the test.
- Do not spend fast time on list pages, detail rendering breadth, toasts, sorting, or tooltip checks.
- Fast specs may use multiple workers; local default is `PLAYWRIGHT_FAST_WORKERS=2`, CI overrides to 4.

## Slow lane rules

- Keep `test.describe.configure({ mode: "serial" })`.
- Write the file as a business story, not a bag of isolated guards.
- Prefer flows like create, edit, submit, receive, confirm, ship, release, complete.
- Include error or guard checks only when they naturally occur in the operational sequence.
- Use `test/e2e/slow/customer-crm.spec.ts` as the breadth model: UI actions first, API response assertions on important mutations, reload/persistence checks, DB assertions through the `db` fixture, and storage assertions when the workflow owns files.
- Avoid pure API-only slow stories unless the contract is intentionally headless or mobile-facing; otherwise anchor the story in the UI and use API/DB checks as evidence.

## Local defaults

- Narrow domain changes: run `pnpm build`, `pnpm lint`, and the relevant `pnpm test:fast:<domain>` locally.
- Shared or cross-domain changes: run `pnpm build`, `pnpm lint`, and `pnpm test:fast` locally.
- Local fast lanes default to 2 Playwright workers so multiple agents are less likely to saturate a workstation. CI overrides this with `PLAYWRIGHT_FAST_WORKERS=4`.
- ERP agent tests are archived with the parked agent. See `docs/erp-agent.md` before restoring live provider coverage.
- If the change is isolated to one domain, add that domain's slow spec locally instead of the whole slow lane
- Use `pnpm test:slow:auth` when touching auth, invites, sessions, team access, or permission gates
  This lane includes both `auth-security.spec.ts` and `team-management.spec.ts`.
- Avoid `pnpm test:slow` locally unless the change is cross-domain or explicitly needs broader workflow confidence
- Do not add ad hoc story suites outside the fast, slow, and auth buckets

## CI cadence

- Local validation is the development gate. GitHub CI is the final clean-room gate for a review-ready SHA.
- Before adding `ci:ready`, run the relevant local checks and record the command results in the PR body or a PR comment.
- Apply the slow-selection label before `ci:ready`; `ci:ready` should be the final label that starts GitHub verification.
- PR CI runs after `ci:ready` is present and verifies a fresh install, migrations/schema, `pnpm build`, `pnpm lint`, and `pnpm test:fast`.
- If you push another commit after final GitHub CI, remove `ci:ready`, rerun local validation, document the new results, then re-add `ci:ready`.
- PR slow CI is label-selected and also waits for `ci:ready`. Every PR needs one of:
  `ci:slow:sales`, `ci:slow:inventory`, `ci:slow:purchasing`,
  `ci:slow:manufacturing`, `ci:slow:stocktake`, `ci:slow:auth`,
  `ci:slow:all`, or `ci:slow:none`.
- Missing `ci:slow:*` labels fail the selector job only after `ci:ready` is present. `ci:slow:none` is for docs-only or CI-only changes and must not be combined with other slow labels.
- Use `ci:slow:all` for shared DB/schema/DAL/API/test infrastructure changes.
- Nightly CI runs `pnpm test:slow` plus `pnpm test:slow:auth`. Manual dispatch can run `all`, one domain, `stocktake`, `auth`, or `none`.
- Failed scheduled slow runs open or update a report-only investigation PR from `main`, comment with the run link, failed jobs, and artifact links, then dispatch the Claude Code workflow with the same prompt. The bot reuses `codex/nightly-slow-failure` while it is open to avoid PR spam.
- The generated investigation PR is a branch for fixes, not an automatic merge candidate. The agent should inspect logs/artifacts, push real code or test fixes when appropriate, and document validation before merge.

## Script aliases

- `pnpm test:fast`: all fast Playwright specs
- `pnpm test:fast:sales`, `pnpm test:fast:inventory`, `pnpm test:fast:purchasing`, `pnpm test:fast:manufacturing`, `pnpm test:fast:stocktake`: domain fast lanes
- `pnpm test:slow`: all slow Playwright specs
- `pnpm test:slow:sales`, `pnpm test:slow:inventory`, `pnpm test:slow:purchasing`, `pnpm test:slow:manufacturing`, `pnpm test:slow:stocktake`, `pnpm test:slow:auth`: selected slow lanes
- Domain slow lanes may include multiple story files. Sales includes order, CRM, and partial-shipment stories; inventory includes item-form, cost-basis, and visibility stories.
- Existing `test:e2e:*`, `test:inventory`, and `test:sales` aliases remain for compatibility.
