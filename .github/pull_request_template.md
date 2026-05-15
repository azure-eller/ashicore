## What changed
<!-- 1-2 sentences describing the change -->

## Why
<!-- What problem does this solve? Link to issue if applicable -->

## How to verify
<!-- Steps to verify this works, or evidence (screenshots for UI changes) -->
- Local validation:
  - [ ] `pnpm build`
  - [ ] `pnpm lint`
  - [ ] Relevant fast/slow Playwright lane(s):
  - [ ] `pnpm verify:inventory` if inventory-affecting
- Final GitHub verification:
  - [ ] Added the correct `ci:slow:*` or `ci:slow:none` label
  - [ ] Added `ci:ready` last, only after local validation passed

## Risks
<!-- What could break? "None" is fine if true -->
