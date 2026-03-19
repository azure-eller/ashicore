---
read_when:
  - After running the scenario generation framework
  - When test/scenarios/<feature>/scenarios.json has untested scenarios
---

# Write Tests From Scenarios

## How to run

```
Read docs/testing-write-from-scenarios.md and execute it against
test/scenarios/product-bom/scenarios.json
```

## Process

1. Read `test/scenarios/<feature>/scenarios.json`
2. Filter to `impact: "HIGH"` and `status: "untested"`
3. For each scenario, write a test. Every single one. No skipping.
4. After ALL tests are written, run `pnpm test`

## Rules

- Implement EVERY filtered scenario. If you skip one, explain why.
- Before you start, count the scenarios per lane and announce: "Writing N schema, N api, N ui tests"
- After you finish, announce: "Implemented N of N scenarios" — the numbers must match.
- Update each scenario's `status` to `"tested"` and `testFile` in scenarios.json when done.

## Test file organization

- Schema tests → `test/schema/<feature>-schema-NNN.test.ts`
- API contract tests → `test/api/<feature>-api-NNN.test.ts`
- UI contract tests → `test/ui/<feature>-ui-NNN.test.tsx`

Spawn 3 parallel agents — one per test lane (schema, api-contract, ui-contract). Each agent gets ALL scenarios for its lane.

## How to write each test type

### schema (testLane: "schema")

```ts
import { insertItemSchema } from "@/lib/schemas/items";

test("scenario name", () => {
  const result = insertItemSchema.safeParse({ /* inputs from actions */ });
  // assert verify statements
});
```

### api-contract (testLane: "api-contract")

```ts
// Mock the DAL
vi.mock("@/app/(dashboard)/inventory/queries", () => ({ ... }));

test("scenario name", async () => {
  const req = new Request("http://localhost/api/items", {
    method: "POST",
    body: JSON.stringify({ /* inputs from actions */ }),
  });
  const res = await POST(req);
  // assert verify statements
});
```

### ui-contract (testLane: "ui-contract")

Read existing test files first. Reuse helpers if they exist.

```tsx
test("scenario name", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);

  renderItemForm({ /* props from scenario setup */ });

  // Follow EVERY step in the actions array
  // Then assert EVERY statement in the verify array
  // For submit scenarios: ALWAYS inspect fetchMock.mock.calls to verify the PAYLOAD
});
```
