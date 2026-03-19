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

## Test infrastructure

All tests run against the REAL stack — real API routes, real database, real RLS. No mocking fetch, no mocking the DAL.

### Global setup (`test/global-setup.ts`)

Vitest runs this once before any test file. It:

1. Creates a test user via Better Auth's signup API (or reuses if exists)
2. Creates a test org (or reuses if exists)
3. Signs in and gets a session token
4. Stores the session token and org ID in environment variables
5. Exports a teardown function that cleans up test data after all tests

```ts
// test/global-setup.ts
import { auth } from "@/lib/auth";

const TEST_EMAIL = "test@erp-test.local";
const TEST_PASSWORD = "test-password-123";
const TEST_ORG_NAME = "Test Org";

export async function setup() {
  // Create test user (or sign in if exists)
  // Create test org (or reuse if exists)
  // Get session token
  // Store in process.env.TEST_SESSION_TOKEN and process.env.TEST_ORG_ID
}

export async function teardown() {
  // Delete test data created during this run (items, units, etc.)
  // Keep the test user and org for next run
}
```

### Test helper (`test/helpers/api.ts`)

Every test uses this helper to make authenticated API calls:

```ts
// test/helpers/api.ts
const BASE_URL = "http://localhost:3000";

export async function testFetch(path: string, options: RequestInit = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Cookie: `session_token=${process.env.TEST_SESSION_TOKEN}`,
      ...options.headers,
    },
  });
}

export async function createItem(data: Record<string, unknown>) {
  const res = await testFetch("/api/items", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return { status: res.status, body: await res.json() };
}

export async function updateItem(id: string, data: Record<string, unknown>) {
  const res = await testFetch(`/api/items/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  return { status: res.status, body: await res.json() };
}
```

### Vitest config

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/setup.ts"],
    // ...
  },
});
```

### Dev server must be running

Tests make real HTTP requests to the API. Start the dev server before running tests:

```bash
pnpm dev &  # or in another terminal
pnpm test
```

## Process

1. Read `test/scenarios/<feature>/scenarios.json`
2. Filter to `impact: "HIGH"` and `status: "untested"`
3. For each scenario, write a test that hits the real API. Every single one. No skipping.
4. After ALL tests are written, run `pnpm test`

## Rules

- Implement EVERY filtered scenario. If you skip one, explain why.
- Before you start, count the scenarios per lane and announce: "Writing N schema, N api, N ui tests"
- After you finish, announce: "Implemented N of N scenarios" — the numbers must match.
- Update each scenario's `status` to `"tested"` and `testFile` in scenarios.json when done.
- NEVER mock fetch. NEVER mock the DAL. Tests hit the real API with real auth.

## Test file organization

- Schema tests → `test/schema/<feature>-schema-NNN.test.ts`
- API tests → `test/api/<feature>-api-NNN.test.ts`
- UI tests → `test/ui/<feature>-ui-NNN.test.tsx`

Spawn 3 parallel agents — one per test lane (schema, api, ui). Each agent gets ALL scenarios for its lane.

## How to write each test type

### schema (testLane: "schema")

Schema tests can still import Zod directly — they're testing the schema logic, not the API.

```ts
import { insertItemSchema } from "@/lib/schemas/items";

test("scenario name", () => {
  const result = insertItemSchema.safeParse({ /* inputs from actions */ });
  // assert verify statements
});
```

### api (testLane: "api-contract")

Use `testFetch` / `createItem` / `updateItem` from the test helper. Real HTTP requests, real auth, real database.

```ts
import { createItem, updateItem, testFetch } from "@/test/helpers/api";

test("scenario name", async () => {
  const { status, body } = await createItem({
    name: "Test Product",
    itemType: "product",
    unitDefinitionId: process.env.TEST_UNIT_ID,
    stock: "0",
    safetyStock: "0",
    bomMode: "quantity",
    bom: [],
  });
  expect(status).toBe(200);
  expect(body.id).toBeDefined();
});
```

### ui (testLane: "ui-contract")

UI tests render the form in JSDOM but the form's `fetch` calls hit the REAL API (dev server must be running). Do not mock fetch.

```tsx
test("scenario name", async () => {
  const user = userEvent.setup();
  renderItemForm({ /* props from scenario setup */ });

  // Follow actions from scenario
  // Submit the form — it calls the REAL API
  // Assert the response and any UI changes
});
```
