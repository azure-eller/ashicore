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

## Fast lane rules

- Use the real browser form for the write boundary under test.
- Stop after submit, one success signal, and DB assertions.
- Use API helpers for setup that is not the subject of the test.
- Do not spend fast time on list pages, detail rendering breadth, toasts, sorting, or tooltip checks.
- Run fast specs with higher Playwright worker counts; local default is `PLAYWRIGHT_FAST_WORKERS=8`, CI overrides lower.

## Slow lane rules

- Keep `test.describe.configure({ mode: "serial" })`.
- Write the file as a business story, not a bag of isolated guards.
- Prefer flows like create, edit, submit, receive, confirm, ship, release, complete.
- Include error or guard checks only when they naturally occur in the operational sequence.

## Local defaults

- Default local command after normal feature work: `pnpm test`
- ERP agent tests are archived with the parked agent. See `docs/erp-agent.md` before restoring live provider coverage.
- If the change is isolated to one domain, add that domain's slow spec locally instead of the whole slow lane
- Use `pnpm test:e2e:auth` when touching auth, invites, sessions, team access, or permission gates
  This lane includes both `auth-security.spec.ts` and `team-management.spec.ts`.
- Avoid `pnpm test:e2e:slow` locally unless the change is cross-domain or explicitly needs broader workflow confidence
- Do not add ad hoc story suites outside the fast, slow, and auth buckets

## CI cadence

- `pnpm test`: default fast lane for day-to-day pushes
- `pnpm test:e2e:slow`: local full slow lane
- Ready-for-review CI runs the slow lane as a matrix, one serial domain file per job
- `pnpm test:e2e:auth`: run in parallel with the slow lane when a PR is marked ready for review
  This covers auth plus team-management/invite regressions.
