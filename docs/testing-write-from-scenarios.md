---
read_when:
  - After running the scenario generation framework
  - When test/scenarios/<feature>/scenarios.json has untested scenarios
  - When asked to write tests from scenarios
---

# Write Tests From Scenarios

Takes the scenarios.json produced by the scenario generation framework and implements them as actual test files. Spawns parallel agents grouped by test lane for speed.

## How to run

```
Read docs/testing-write-from-scenarios.md and execute it against
test/scenarios/product-bom/scenarios.json. HIGH priority only.
```

## Process

### Step 1: Read and group scenarios

Read `test/scenarios/<feature>/scenarios.json`. Filter to scenarios where:
- `status` is `"untested"`
- `impact` is `"HIGH"` (unless told otherwise)

Group the filtered scenarios by `testLane`:
- `schema` → tests go in `test/schema/`
- `api-contract` → tests go in `test/api/`
- `ui-contract` → tests go in `test/ui/`

### Step 2: Launch parallel agents (one per test lane)

Spawn one agent per test lane. Each agent receives ONLY the scenarios for its lane. All agents run in parallel.

### Schema test agent

```
You are a test writer. Write Vitest tests for these scenarios.

Each test imports the Zod schema directly and calls .safeParse() or .parse()
with the inputs described in the scenario's actions. Assert the results
match the scenario's verify statements.

Scenarios to implement:
[PASTE SCHEMA SCENARIOS]

Read the actual schema file to understand the types:
- lib/schemas/items.ts

Write tests to: test/schema/items-schema.test.ts

Use this pattern:
import { describe, test, expect } from "vitest";
import { insertItemSchema, updateItemSchema } from "@/lib/schemas/items";

describe("items schema", () => {
  test("[scenario name]", () => {
    const result = insertItemSchema.safeParse({ ... });
    // assert based on verify statements
  });
});

After writing, list which scenario IDs you implemented.
```

### API contract test agent

```
You are a test writer. Write Vitest tests for these scenarios.

Each test calls the API route handler directly with a crafted Request object.
Mock the DAL layer (queries.ts) to isolate the route logic. Assert response
status codes, JSON bodies, and error shapes match the scenario's verify statements.

Scenarios to implement:
[PASTE API CONTRACT SCENARIOS]

Read these files to understand the route handlers:
- app/api/items/route.ts
- app/api/items/[id]/route.ts
- lib/api/handler.ts
- lib/schemas/items.ts

Write tests to: test/api/items-route.test.ts

Use this pattern:
import { describe, test, expect, vi } from "vitest";

// Mock the DAL
vi.mock("@/app/(dashboard)/inventory/queries", () => ({ ... }));

describe("items API routes", () => {
  test("[scenario name]", async () => {
    const req = new Request("http://localhost/api/items", {
      method: "POST",
      body: JSON.stringify({ ... }),
    });
    const res = await POST(req);
    expect(res.status).toBe(...);
    // assert based on verify statements
  });
});

After writing, list which scenario IDs you implemented.
```

### UI contract test agent

```
You are a test writer. Write Vitest + React Testing Library tests for
these scenarios.

Each test renders the form component, simulates user interactions from
the scenario's actions array, and asserts the results match the verify
statements. Use userEvent for interactions. Mock fetch for API calls.

Scenarios to implement:
[PASTE UI CONTRACT SCENARIOS]

Read these files to understand the components:
- app/(dashboard)/inventory/item-form.tsx
- app/(dashboard)/inventory/bom-editor.tsx
- lib/schemas/items.ts

If test/setup.ts and test/ui/item-form.contract.test.tsx already exist,
read them first and extend rather than recreate. Reuse existing helpers
(renderItemForm, getBomRows, chooseSelectOption, etc.) if available.

Write tests to: test/ui/item-form.contract.test.tsx (extend existing file
or create new describe blocks)

Use this pattern:
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

describe("[scenario group]", () => {
  test("[scenario name]", async () => {
    const user = userEvent.setup();
    renderItemForm({ ... });
    // follow actions from scenario
    // assert verify statements
  });
});

After writing, list which scenario IDs you implemented.
```

### Step 3: Update scenario status

After all agents complete, read their outputs to get the list of implemented
scenario IDs. Update scenarios.json:
- Set `status` to `"tested"` for each implemented scenario
- Set `testFile` to the path where the test was written

### Step 4: Run the tests

```bash
pnpm test
```

Report which tests pass and which fail. Failing tests reveal where the code
diverges from the scenario specification — these are the bugs.
