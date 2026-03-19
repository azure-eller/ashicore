---
read_when:
  - Before writing tests for a new feature
  - Before writing tests for an existing feature that lacks coverage
  - When reviewing a PR that changes form behavior, API routes, or schemas
  - When adding a new module or entity
---

# Test Scenario Generation Framework

Multi-phase, multi-agent process for generating comprehensive test scenarios. Each scenario is a specification: a sequence of user actions and the expected correct behavior. Tests implement these specifications — passing tests confirm the behavior is correct, failing tests reveal where the code diverges from the spec.

## When to use this

- New feature with forms, API routes, or schema changes
- Existing feature that has no tests or weak tests
- After a bug is found that tests should have caught

## Overview

```
Phase 0: Domain Axes (1 agent → human review)
  → Agent reads architecture docs + code
  → Proposes variation axes (dimensions that create different behavior)
  → Human approves/edits in 30 seconds
  → Writes variation-axes.json

Phase 1: Reconnaissance (4 parallel agents → 1 merge agent)
  → Agent 1A: Action extraction (form components)
  → Agent 1B: State inventory (React hooks + form state)
  → Agent 1C: Data pipeline traces (schema → API → DAL → DB)
  → Agent 1D: DB constraints + visual indicators
  → Merge agent: combine into interaction map, write JSON files

Phase 2: Scenario Generation (4 parallel specialist agents, each writes its own file)
  → Each specialist receives the recon map AND the variation axes
  → Agent A: Data Pipeline — trace every field from input to DB, specify expected transformations
  → Agent B: State Transitions — specify expected state after each interaction sequence
  → Agent C: Validation Boundaries — specify expected behavior at every constraint boundary
  → Agent D: Cross-Feature Flows — specify expected behavior when this feature's output feeds other features
  → Each agent writes to its own file: scenarios-<specialist>.json

Phase 3: Mechanical merge + intelligent dedup (script + 1 agent)
  → Script: merge all 4 specialist JSON files into one array (lossless, no data dropped)
  → Agent: deduplicate near-duplicates, fill coverage gaps, write final scenarios.json
```

Total: 12 agent invocations. Phase 0 runs first (requires human approval). Phases 1A-1D run in parallel, then merge. Phase 2 agents A-D run in parallel. Phase 3 merge script is deterministic, then gap-fill agent runs last.

### Why each specialist writes its own file

If all 4 specialists output 20+ scenarios each (80+ total), a single curator agent will lose detail when summarizing. Instead:

1. Each specialist writes directly to `test/scenarios/<feature>/scenarios-<name>.json`
2. A deterministic script concatenates all arrays — zero data loss
3. The curator agent only handles the intelligent part: resolving near-duplicates and filling coverage gaps

## Persistence: Scenario Files

Scenarios are stored as structured JSON files in the repo so future runs build on previous findings instead of regenerating from scratch.

### Directory structure

```
test/scenarios/
  <feature>/
    # Phase 0 output (human-approved)
    variation-axes.json             — domain dimensions + critical combinations

    # Phase 1 outputs (reconnaissance)
    actions.json                    — every user action in this feature
    state-inventory.json            — every piece of React state
    data-pipeline.json              — field-by-field pipeline traces
    interactions.json               — which actions share state
    db-constraints.json             — DB constraints + Zod coverage status
    visual-indicators.json          — UI signals + enforcement status
    meta.json                       — generation metadata

    # Phase 2 outputs (per-specialist, preserved for traceability)
    scenarios-data-pipeline.json    — Agent A output
    scenarios-state-transition.json — Agent B output
    scenarios-validation.json       — Agent C output
    scenarios-cross-feature.json    — Agent D output

    # Phase 3 output (final merged + deduplicated)
    scenarios.json                  — the canonical scenario list agents use for test writing
```

### Scenario format

Each scenario is a **test specification** — what to do, what to verify, and how impactful it is if the verification fails:

```json
{
  "scenarios": [
    {
      "id": "submit-after-bom-mode-switch",
      "name": "Submit after switching BOM mode",
      "category": "state-transition",
      "actions": [
        "Add BOM ingredient in quantity mode",
        "Enter quantity '5'",
        "Switch to percentage mode",
        "Enter percentage '50'",
        "Submit form"
      ],
      "verify": [
        "Payload bomMode is 'percentage'",
        "Payload bom[0].percentage is '50'",
        "Payload bom[0].quantity is null (cleared on mode switch)"
      ],
      "impact": "HIGH",
      "testLane": "ui-contract",
      "foundBy": ["data-pipeline", "state-transition"],
      "status": "untested",
      "testFile": null
    }
  ]
}
```

**Field descriptions:**
- `actions`: step-by-step user interactions a test agent follows
- `verify`: the expected correct behavior — what the test asserts
- `impact`: if verification fails, how bad is it? HIGH = data corruption or money impact, MEDIUM = misleading UI or wrong display, LOW = cosmetic or unlikely
- `testLane`: which test type to write — `schema`, `api-contract`, `ui-contract`, or `browser-smoke`
- `status`: `untested` → `tested` → `passing` → `failing`
- `testFile`: path to the test file once written

### Incremental re-runs

On subsequent runs:

1. Read `meta.json` — compare source file hashes against current git state
2. If source files are unchanged → skip reconnaissance, reuse existing files
3. If source files changed → re-run reconnaissance for changed files only
4. Diff new actions against existing `actions.json`:
   - New actions → generate scenarios for them
   - Removed actions → mark their scenarios as `obsolete: true`
   - Changed interactions → re-run scenario generation for affected action clusters
5. Append new scenarios, preserve existing ones and their status

## Phase 0: Domain Variation Axes

**Purpose**: Identify the key dimensions that create meaningfully different behavior when combined. Code-derived reconnaissance finds what the code does, but variation axes capture the domain combinations that matter — the ones agents consistently miss because they're not visible in any single file.

**Agent count**: 1 (output requires human approval before proceeding)

```
You are a domain analyst. Read the architecture docs and feature code to identify
the key variation axes for this feature. An axis is a dimension where different
values create meaningfully different behavior.

Read these files:
[LIST ARCHITECTURE DOC + ALL FEATURE FILES]

Propose 8-12 variation axes. Each axis should represent a dimension where
different values change how the feature behaves — not just different data.
"Name is short vs long" is not useful. "Product with BOM vs without BOM" IS
useful because entire UI sections and code paths change.

Write to test/scenarios/<feature>/variation-axes.json:
{
  "feature": "[feature name]",
  "axes": [
    {
      "name": "[short-kebab-name]",
      "description": "[what this axis represents]",
      "values": ["value-a", "value-b"],
      "dependsOn": "[other axis name, or null if independent]"
    }
  ],
  "criticalCombinations": [
    {
      "description": "[why this combination matters]",
      "axes": { "axis-1": "value", "axis-2": "value" }
    }
  ]
}

The criticalCombinations section should list 10-15 specific axis combinations
that are especially important — the ones where different code paths intersect
in ways that could produce unexpected behavior.
```

**After the agent writes variation-axes.json**: present the axes to the human for review. The human approves, edits, or adds axes. This is a 30-second review, not a writing task — the agent does the thinking, the human just confirms.

Once approved, pass variation-axes.json to all Phase 2 specialists alongside the recon map.

## Phase 1: Reconnaissance

Split into 4 parallel sub-agents for thoroughness. Phase 1 prompts are unchanged from the reconnaissance-focused design — they extract facts from the code, not scenarios.

### Agent 1A: Action Extraction

```
You are a UI action extraction agent. Read form components and list every
distinct thing a user can do.

Read these files:
[LIST FORM COMPONENT FILES ONLY]

If a previous actions.json exists at [PATH], read it first. Find NEW actions
not already listed, and flag any listed actions that no longer exist in the code.

Produce a JSON object:
{
  "actions": [
    {
      "id": "[kebab-case-unique-id]",
      "description": "[specific — 'switch BOM mode from quantity to percentage' not 'change mode']",
      "component": "[filename]",
      "line": [line number],
      "stateAffected": ["[state variables this action touches]"]
    }
  ],
  "removedActions": ["[ids that no longer exist]"]
}

Be exhaustive. Every button click, input change, dropdown selection, dialog
open/close is a separate action. "Switch from A to B" is different from
"switch from B to A."
```

### Agent 1B: State Inventory

```
You are a React state inventory agent. Catalog every piece of mutable state.

Read these files:
[LIST FORM COMPONENT FILES ONLY]

If a previous state-inventory.json exists at [PATH], read it first and update.

Produce a JSON object:
{
  "state": [
    {
      "name": "[variable name]",
      "type": "[useState | useForm field | useFieldArray | useWatch | useMemo | useMutation | derived]",
      "dataType": "[string | boolean | array | object | ...]",
      "definedIn": "[filename:line]",
      "initialValue": "[initial value or description]",
      "modifiedBy": ["[action ids that modify this state]"],
      "persistsOnUnmount": "[true/false]"
    }
  ]
}
```

### Agent 1C: Data Pipeline Traces

```
You are a data pipeline tracing agent. Trace every form field's data from
user input through every transformation to the database.

Read these files:
[LIST ALL FILES: form, schema, API routes, DAL queries, DB schema]

If a previous data-pipeline.json exists at [PATH], read it first and update.

Produce a JSON object:
{
  "pipelines": [
    {
      "field": "[form field name]",
      "input": "[what the user types]",
      "formState": "[how react-hook-form stores it]",
      "zodTransform": "[what the Zod transform does — be specific]",
      "zodValidation": "[what Zod rules check — or 'NONE']",
      "apiHandler": "[how the API route processes it]",
      "dalFunction": "[how the DAL uses it]",
      "dbColumn": "[column name, type, constraints]"
    }
  ]
}
```

### Agent 1D: DB Constraints & Visual Indicators

```
You are a constraint and indicator auditing agent. Catalog every database
constraint and every UI visual indicator, and note whether each has a
matching counterpart.

Read these files:
[LIST ALL FILES]

If previous files exist at [PATH], read them first and update.

Produce TWO JSON objects:

## db-constraints.json
{
  "constraints": [
    {
      "table": "[table]",
      "column": "[column]",
      "type": "[varchar-length | numeric-precision | not-null | unique | fk | check]",
      "details": "[e.g. varchar(50), numeric(10,4)]",
      "zodEquivalent": "[the matching Zod rule, or 'NONE']",
      "covered": true/false
    }
  ]
}

## visual-indicators.json
{
  "indicators": [
    {
      "element": "[description]",
      "component": "[filename:line]",
      "signal": "[what it tells the user]",
      "enforcement": "[matching schema rule, or 'COSMETIC ONLY']",
      "enforced": true/false
    }
  ]
}
```

### Merge Agent

```
You are a reconnaissance merge agent. Combine the 4 sub-agent outputs
and build the interaction map.

Here are the outputs:
[PASTE AGENT 1A OUTPUT — actions]
[PASTE AGENT 1B OUTPUT — state inventory]
[PASTE AGENT 1C OUTPUT — data pipelines]
[PASTE AGENT 1D OUTPUT — constraints and indicators]

## Step 1: Write files
Write each output to its corresponding JSON file in test/scenarios/<feature>/.
Write meta.json with the current timestamp and source file hashes.

## Step 2: Build the interaction map
Using the actions and state inventory, build interactions.json:
{
  "interactions": [
    {
      "action": "[action id]",
      "interactsWith": [
        {
          "action": "[other action id]",
          "sharedState": ["[state variables they both touch]"],
          "reason": "[why this interaction matters for testing]"
        }
      ]
    }
  ]
}

Two actions interact if they touch the same state variable, form field,
validation rule, or DB column.

## Step 3: Produce summary
Output a markdown summary for the Phase 2 specialists. Include: action count,
state count, pipeline count, uncovered constraint count, unenforced indicator
count, and the top 10 most important interactions.
```

## Phase 2: Scenario Generation

Four specialist agents define test scenarios from different angles. Each scenario is a **specification**: actions to perform + expected correct behavior to verify.

**Agent count**: 4 (run in parallel)

Pass each specialist:
1. The Phase 1 merge output (recon map)
2. The variation-axes.json from Phase 0
3. The existing scenarios.json if it exists (with instruction: "Only generate NEW scenarios not already covered")

Each specialist writes directly to `test/scenarios/<feature>/scenarios-<name>.json`.

**Using the variation axes**: Each specialist must generate scenarios that cover the critical combinations from variation-axes.json. For every critical combination, generate at least one scenario that exercises that specific combination of axis values. This ensures cross-axis coverage that code-only analysis misses.

### Agent A: Data Pipeline Specialist

```
You are a data pipeline scenario writer. Your job is to specify the expected
behavior for every meaningful input → transformation → storage path in this feature.

For every field in the form, consider: what are all the meaningful inputs a user
could provide, and what should the system do with each one? Define scenarios that
specify the correct transformation at each step.

Here is the reconnaissance map:
[PASTE PHASE 1 MERGE OUTPUT]

Here are the variation axes for this feature:
[PASTE variation-axes.json]

For each critical combination in the axes, generate at least one scenario that
exercises that specific combination through the data pipeline.

Read these files:
[LIST ALL FILES]

Your process — follow each step explicitly:

## Step 1: For every field, enumerate meaningful inputs
For each field in the data pipeline, list the categories of input to test:
- Valid typical value
- Empty / blank / whitespace-only
- Null vs undefined vs empty string
- Boundary values (zero, negative, max length, max precision)
- Non-numeric strings in numeric-intent fields
- Values that exceed DB column limits

## Step 2: For every pair of interacting fields, enumerate meaningful combinations
Using the interaction map, identify field pairs that share state or validation.
For each pair, specify what the correct behavior should be when both are exercised.

## Step 3: For concurrent access patterns, specify expected behavior
What should happen when two users edit the same entity? What is the correct
behavior for stale references?

## Step 4: Write scenarios
For each meaningful input or combination, produce a scenario:

{
  "id": "[kebab-case-id]",
  "name": "[descriptive name]",
  "category": "data-pipeline",
  "actions": ["step 1", "step 2", "...", "submit"],
  "verify": ["expected result 1", "expected result 2"],
  "impact": "HIGH/MEDIUM/LOW",
  "testLane": "schema | api-contract | ui-contract"
}

Use 3-8 action steps. Verifications should describe the EXPECTED CORRECT behavior.
Generate AT LEAST 20 scenarios.

Write to test/scenarios/<feature>/scenarios-data-pipeline.json.
```

### Agent B: State Transition Specialist

```
You are a state transition scenario writer. Your job is to specify the expected
state after every meaningful sequence of user interactions in this feature.

For every piece of React state, consider: what sequences of actions could leave
the state in an unexpected condition? Define scenarios that specify what the
correct state should be after each sequence.

Here is the reconnaissance map:
[PASTE PHASE 1 MERGE OUTPUT]

Here are the variation axes for this feature:
[PASTE variation-axes.json]

For each critical combination in the axes, generate at least one scenario that
exercises that combination's effect on state transitions (e.g., "edit existing
product + switch BOM mode" is a different state path than "create new + switch mode").

Read these files:
[LIST FORM AND SCHEMA FILES]

Your process — follow each step explicitly:

## Step 1: For every piece of state, enumerate lifecycle sequences
Trace each state variable through: creation → modification → cleanup.
Specify what the correct value should be after each transition.

## Step 2: For every conditional render, specify persistence behavior
When UI conditionally renders (mode-dependent fields, dialogs, dynamic arrays),
specify: what should the state be after mount, unmount, and remount?

## Step 3: For every dynamic list operation, specify index behavior
When items are added, removed, and re-added in useFieldArray, specify:
what should the field values and validation errors look like after each operation?

## Step 4: Write scenarios
For each state transition sequence, produce a scenario:

{
  "id": "[kebab-case-id]",
  "name": "[descriptive name]",
  "category": "state-transition",
  "actions": ["step 1", "step 2", "...", "verify state"],
  "verify": ["state X should be Y", "state Z should be cleared"],
  "impact": "HIGH/MEDIUM/LOW",
  "testLane": "ui-contract"
}

Use 5-8 action steps. State bugs emerge from CHAINS of interactions — longer
sequences are more valuable here. Verifications should describe the EXPECTED
CORRECT state, including what should be CLEARED or RESET.
Generate AT LEAST 20 scenarios.

Write to test/scenarios/<feature>/scenarios-state-transition.json.
```

### Agent C: Validation Boundary Specialist

```
You are a validation boundary scenario writer. Your job is to specify the
expected behavior at every validation boundary in this feature — every point
where the system should accept or reject input.

For every constraint (Zod rules, DB constraints, UI indicators), define
scenarios that specify what the correct acceptance/rejection behavior should be.

Here is the reconnaissance map:
[PASTE PHASE 1 MERGE OUTPUT]

Here are the variation axes for this feature:
[PASTE variation-axes.json]

For each critical combination, verify that validation behaves correctly across
axis values (e.g., validation in create mode vs edit mode, validation in
quantity mode vs percentage mode).

Read these files:
[LIST ALL FILES]

Your process — follow each step explicitly:

## Step 1: For every visual indicator, specify expected enforcement
For each UI element that communicates validation state (error messages, warnings,
disabled states, input hints), specify: should submission be blocked or allowed?

## Step 2: For every Zod rule, specify boundary behavior
For each validation rule, specify the exact boundary: what is the last
acceptable value, and what is the first rejected value?

## Step 3: For every DB constraint, specify expected Zod coverage
For each DB constraint, specify: should Zod catch this with a friendly error,
or is it acceptable for the DB to reject it?

## Step 4: For fields that should have matching validation, specify the expected symmetry
Compare similar fields (e.g., stock vs safetyStock, purchasePrice vs sellingPrice).
Specify what the consistent validation behavior should be.

## Step 5: Write scenarios
For each boundary, produce a scenario:

{
  "id": "[kebab-case-id]",
  "name": "[descriptive name]",
  "category": "validation",
  "actions": ["enter specific value", "submit"],
  "verify": [
    "submission should be blocked/allowed",
    "error message should say X / no error should appear",
    "field value in payload should be X"
  ],
  "impact": "HIGH/MEDIUM/LOW",
  "testLane": "schema | api-contract | ui-contract"
}

Generate AT LEAST 20 scenarios.

Write to test/scenarios/<feature>/scenarios-validation.json.
```

### Agent D: Cross-Feature Flow Specialist

```
You are a cross-feature scenario writer. Your job is to specify the expected
behavior when this feature's output is consumed by other parts of the system.

For every piece of data this feature writes, trace it to its downstream
consumers and specify what the correct end-to-end behavior should be.

Here is the reconnaissance map:
[PASTE PHASE 1 MERGE OUTPUT]

Here are the variation axes for this feature:
[PASTE variation-axes.json]

For each critical combination, trace the downstream impact. A product created
with a percentage BOM has different downstream effects than one with a quantity
BOM. Exercise these differences explicitly.

Read these files — the form AND everything downstream:
[LIST ALL FILES including DAL queries, other features that consume this data]

Your process — follow each step explicitly:

## Step 1: Trace downstream consumers
For every field this form writes to the database, identify what other code
reads this data. Specify what the correct behavior should be for each consumer.

## Step 2: Specify referential integrity behavior
For every foreign key relationship, specify: what should happen when referenced
data is created, modified, or deleted? Can circular references form, and if so,
what should the correct handling be?

## Step 3: Specify calculation behavior
For every numeric field, trace downstream calculations (stock, cost, BOM explosion).
Specify what the correct calculation results should be for typical and edge-case inputs.

## Step 4: Specify concurrent access behavior
Specify what should happen when two users edit the same entity simultaneously.
What is the correct conflict resolution behavior?

## Step 5: Write scenarios
For each cross-feature flow, produce a scenario:

{
  "id": "[kebab-case-id]",
  "name": "[descriptive name]",
  "category": "cross-feature",
  "actions": ["form action 1", "submit", "downstream action", "verify"],
  "verify": ["downstream result should be X", "related data should be Y"],
  "impact": "HIGH/MEDIUM/LOW",
  "testLane": "api-contract | ui-contract"
}

Generate AT LEAST 15 scenarios.

Write to test/scenarios/<feature>/scenarios-cross-feature.json.
```

## Phase 3: Mechanical Merge + Intelligent Dedup

### Step 1: Mechanical Merge (deterministic, zero data loss)

Concatenate all 4 specialist JSON files into one array. This is a script — no data can be lost.

```bash
node -e "
const fs = require('fs');
const dir = process.argv[1];
const files = [
  'scenarios-data-pipeline.json',
  'scenarios-state-transition.json',
  'scenarios-validation.json',
  'scenarios-cross-feature.json',
].map(f => dir + '/' + f).filter(f => fs.existsSync(f));

const all = files.flatMap(f => {
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  const source = f.split('/').pop().replace('scenarios-', '').replace('.json', '');
  return (data.scenarios || []).map(s => ({
    ...s,
    foundBy: [...new Set([...(s.foundBy || []), source])]
  }));
});

const merged = { mergedAt: new Date().toISOString(), totalRaw: all.length, scenarios: all };
fs.writeFileSync(dir + '/scenarios-merged-raw.json', JSON.stringify(merged, null, 2));
console.log('Merged ' + all.length + ' scenarios from ' + files.length + ' specialist files');
" test/scenarios/<feature>
```

### Step 2: Intelligent Dedup + Gap Analysis (1 agent)

```
You are a test scenario deduplicator. You have a mechanically merged list of
scenarios from 4 specialists. Every scenario is already in this list.

Read these files:
- test/scenarios/<feature>/scenarios-merged-raw.json (the full merged list)
- test/scenarios/<feature>/actions.json (for coverage checking)
- test/scenarios/<feature>/db-constraints.json (for coverage checking)
- test/scenarios/<feature>/visual-indicators.json (for coverage checking)
- test/scenarios/<feature>/scenarios.json (if it exists from a prior run)

Your process — follow each step explicitly:

## Step 1: Count the input
Count the total scenarios in scenarios-merged-raw.json and report the number.
Your final output must account for every one — kept, merged, or removed with
justification.

## Step 2: Identify near-duplicates
Two scenarios are near-duplicates if they specify the same actions and
verifications for the same behavior. When you find near-duplicates:
- Keep the most detailed version
- Merge the foundBy arrays
- List each merge: "Merged [ID-A] + [ID-B] → kept [ID-A] because [reason]"

Scenarios that test different fields with the same root cause are SEPARATE
(e.g., "non-numeric purchase price" and "non-numeric selling price" are
both needed even though the underlying issue is the same).

## Step 3: Preserve existing scenario status
If a prior scenarios.json exists:
- Keep existing scenarios that are not obsolete
- If a new scenario matches an existing one, update details but preserve
  status and testFile
- Scenarios that are already tested or passing keep their status

## Step 4: Coverage verification
Check against the reconnaissance files:
- Every action in actions.json has at least one scenario exercising it
- Every uncovered DB constraint has a scenario specifying the expected behavior
- Every unenforced visual indicator has a scenario specifying the expected behavior
Generate additional scenarios for any gaps found.

## Step 5: Write final output
Write to test/scenarios/<feature>/scenarios.json.

Report:
- Input: [N] raw scenarios from merge
- Near-duplicates merged: [N] (list each)
- Coverage gaps filled: [N] new scenarios added
- Final total: [N] unique scenarios
- Breakdown: [N] HIGH, [N] MEDIUM, [N] LOW
```

## How to run this

### In Claude Code

```
Phase 0: 1 Agent call → writes variation-axes.json → PAUSE for human review
Phase 1: 4 parallel Agent calls (1A, 1B, 1C, 1D)
Phase 1 Merge: 1 Agent call with all 4 outputs → writes recon JSON files
Phase 2: 4 parallel Agent calls (A, B, C, D) → each receives recon + axes → writes scenarios-<name>.json
Merge script: Bash call → produces scenarios-merged-raw.json
Phase 3: 1 Agent call → reads merged file, writes final scenarios.json
```

### In Codex

Same structure — use the task/subtask system to run parallel phases.

## Adapting for different features

Replace `[LIST ALL FILES]` with the actual files for the feature being tested:

| Feature | Files to include |
|---------|-----------------|
| Product form + BOM | item-form.tsx, bom-editor.tsx, lib/schemas/items.ts, app/api/items/route.ts, app/api/items/[id]/route.ts, inventory/queries.ts, lib/db/schema/items.ts, lib/db/schema/bom.ts |
| Material form | item-form.tsx, lib/schemas/items.ts, app/api/items/route.ts, inventory/queries.ts, lib/db/schema/items.ts |
| Data table + bulk operations | data-table.tsx, app/api/items/route.ts, app/api/items/[id]/route.ts, inventory/queries.ts |
| Auth + org setup | signup-form.tsx, login-form.tsx, org-setup-form.tsx, relevant API routes |

## Expected output

For a typical form feature, this framework produces:
- 50-80 unique scenarios after deduplication
- 15-25 HIGH impact
- 20-30 MEDIUM impact
- 10-15 LOW impact

The scenarios become the test catalog for that feature. Agents implement them as tests; humans review the list before implementation begins.
