---
read_when:
  - After running the scenario generation framework
  - When test/scenarios/<feature>/scenarios.json has untested scenarios
---

# Write Tests From Scenarios

## Prerequisites

- Dev server running (`pnpm dev`)
- `test/.test-env.json` exists (created by `pnpm test` global setup on first run)

## How it works

All fetch calls in tests are automatically proxied to the real dev server with auth (configured in `test/setup.ts`). When a test renders a form and clicks submit, the form's own `fetch("/api/items", ...)` hits the real API, real DAL, real database. No mocking.

## How to run

```
Read docs/testing-write-from-scenarios.md and execute it against
test/scenarios/product-bom/scenarios.json
```

## Process

1. Read `test/scenarios/<feature>/scenarios.json`
2. Filter to `impact: "HIGH"` and `status: "untested"`
3. Count them. Announce: "Writing N tests"
4. Write a test for every single one. No skipping.
5. Run `pnpm test`
6. Announce: "Implemented N of N. X passed, Y failed."
7. Update `status` and `testFile` in scenarios.json

## Rules

- Implement EVERY scenario. No skipping.
- Tests hit the REAL API. Never mock fetch. Never mock the DAL.
- `test/helpers/api.ts` has helpers (`createItem`, `updateItem`, etc.) for test SETUP — use them to seed data needed before the test (e.g., create a product before testing edit).
- For testing the actual user flow, render the form and interact with it via RTL.
- Spawn 3 parallel agents — one per test lane.

## Test patterns

### Schema test

```ts
import { insertItemSchema } from "@/lib/schemas/items";

test("scenario name", () => {
  const result = insertItemSchema.safeParse({ /* inputs from actions */ });
  // assert verify statements
});
```

### API test

Use the helpers from `test/helpers/api.ts`. These hit the real API with real auth.

```ts
import { createItem, getUnitId } from "@/test/helpers/api";

test("scenario name", async () => {
  const { status, body } = await createItem({
    name: "Test Product",
    itemType: "product",
    unitDefinitionId: getUnitId(),
    stock: "0",
    safetyStock: "0",
  });
  expect(status).toBe(201);
});
```

### UI test

Render the form, interact with it, let it submit to the real API.

```tsx
test("scenario name", async () => {
  const user = userEvent.setup();
  render(<ItemForm itemType="product" units={units} categories={[]} availableComponents={components} />);

  // Fill form using actions from scenario
  await user.type(screen.getByLabelText("Name"), "Test Product");
  // ... more interactions ...
  await user.click(screen.getByRole("button", { name: /create/i }));

  // The form's fetch hits the real API (proxied by setup.ts)
  // Assert based on verify statements
});
```
