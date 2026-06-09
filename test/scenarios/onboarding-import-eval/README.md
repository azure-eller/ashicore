# Onboarding Import Eval Scenarios

Run the full scenario set with:

```sh
pnpm eval:onboarding-import:all
```

Run repeated passes to expose flaky extraction behavior:

```sh
pnpm eval:onboarding-import:all -- --repeat 3
```

Run one scenario with:

```sh
pnpm eval:onboarding-import -- <input-file> --expect <expect-file>
```

Each single-file run writes raw extraction, normalized package, validation preview, summary, and per-attempt JSON under `.tmp/onboarding-import-eval/`.
The suite writes a machine-readable summary under `.tmp/onboarding-import-eval-suite/<timestamp>/summary.json`.
With `--repeat`, the summary includes per-scenario pass counts and every child run's artifact directory.

Scenario expectations are intentionally lightweight. They should assert durable behavior:

- required entities that must be extracted
- minimum and maximum counts when those counts represent a real invariant
- forbidden UOMs, generic package names, borrowed phones, duplicate stock rows, and missing references
- allowed or forbidden provenance sheets for workbook opening stock
- `requireProvenance` when extracted records must include a usable source location and confidence
- full item names from visible current-inventory workbook headers when hidden/order sheets also contain abbreviations
- issue ceilings only when the expected review state is stable

Avoid expectations that overfit incidental model wording or every row in one customer workbook. Add new fixtures when a miss represents a general class of extraction behavior.
