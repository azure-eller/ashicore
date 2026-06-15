---
read_when:
  - Writing or editing an API route in app/api/
  - Writing a mutation (useMutation) in a component
  - Handling validation errors or API error responses
  - Setting up TanStack Query keys
---

# API Patterns

## Route Structure

All mutations (create, update, delete) go through API routes. No server actions.

Every route handler must be wrapped with `apiHandler`:

```ts
import { apiHandler } from "@/lib/api/handler";

export const POST = apiHandler(async (req) => {
  // handler body
});
```

`apiHandler` handles auth, error boundaries, and response formatting.

Do not leave guarded `GET` handlers as bare `export async function GET(...) { ... }`. If a read guard throws `AuthorizationError`, only `apiHandler` will turn it into the repo-standard JSON `403` instead of a framework `500`.

## Validation Error Shape

Field-level validation errors (Zod failures) must include both a top-level
message for action surfaces and field details for forms. Parse JSON request
bodies with `parseJsonBody` inside `apiHandler` so body parsing stays consistent
and the shared handler formats validation failures.

```ts
import { parseJsonBody } from "@/lib/api/request-body";

const data = await parseJsonBody(req, schema);
```

Use `parseOptionalJsonBody(req, schema, fallback)` for endpoints that accept an
empty body. Do not call `request.json()` directly in API routes.

Response shape:

```ts
{ error: "Ship date is required", errors: { shipDate: ["Ship date is required"] } }
```

Note: **`error`** is for the visible message, and **`errors`** is what
react-hook-form's `setError` expects.

## General Error Shape

Non-field errors (not found, forbidden, business logic failures):

```ts
import { jsonError, jsonNotFound } from "@/lib/api/responses";

return jsonError("You do not have access to allocation.", 403);
return jsonNotFound("Item not found");
```

Note: **`error`** (singular) for general errors. Never use `errors` for non-field errors.

## Idempotency Keys

Mutations a client may retry require an `Idempotency-Key` header so a retry
replays the original result instead of creating a duplicate. This now covers the
customer, supplier, purchase-order, and manufacturing-order create routes plus
the purchase-order and manufacturing-order duplicate routes, alongside the
existing sales-order, item-card, and inventory stock writes. Read the header with
`requireIdempotencyKey` and thread it into the DAL:

```ts
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";

export const POST = apiHandler(async (request) => {
  const idempotencyKey = requireIdempotencyKey(request, "createCustomer");
  const data = await parseJsonBody(request, insertCustomerSchema);
  const created = await createCustomer(data, { idempotencyKey });
  // ...
});
```

A missing header is a `400`; reusing one key for a different request body is a
`409`. Clients pass it through `apiJson`'s `idempotencyKey` option, and the card
kernel reuses a retry-stable key so an interrupted create or save replays as the
same write (see [card-kernel.md](./card-kernel.md)).

DAL create/duplicate implementations that use the inventory idempotency ledger
must go through `runIdempotentInventoryOperationInTx`; do not hand-thread the
`beginInventoryOperationInTx` / `finishInventoryOperationInTx` pair at each call
site. The helper claims before reading mutable source rows and always records
the returned result, including `null` not-found outcomes.

## Query Params

Use `lib/routing/search-params.ts` for request query parsing instead of rebuilding
`new URL(request.url)` in each route.

```ts
import {
  requestSearchParamRecord,
  requestSearchParams,
} from "@/lib/routing/search-params";

const query = querySchema.parse(requestSearchParamRecord(request));
const itemIds = requestSearchParams(request).getAll("itemId");
```

## Numeric Response Shape

API success payloads should return canonical numeric strings, not fixed Postgres scale. Keep exact decimals as strings, but trim trailing zeroes in DAL read selectors before the route calls `NextResponse.json(...)`.

```ts
quantity: trimScale(lots.quantity).as("quantity"),
totalAmount: trimScale(salesOrders.totalAmount).as("totalAmount"),
```

Do not coerce exact decimals to JS `number` in API responses.

## Domain Errors

API-facing business errors with shared JSON response behavior should extend `DomainError` from `lib/errors/domain-error.ts` instead of re-implementing `status` and `toResponse()`.

- Put field validation failures in `errors`; `toResponse()` also includes `error`
- Put domain-specific warning payloads in `extra`
- `toResponse()` returns `{ error, errors }` for field errors, otherwise `{ error, ...extra }`

```ts
export class StocktakeError extends DomainError<{
  stale: StocktakeStaleWarningPayload;
}> {
  stale?: StocktakeStaleWarningPayload;

  constructor(
    message: string,
    status = 400,
    options?: {
      errors?: Record<string, string[]>;
      stale?: StocktakeStaleWarningPayload;
    }
  ) {
    super(message, status, {
      name: "StocktakeError",
      errors: options?.errors,
      extra: options?.stale ? { stale: options.stale } : undefined,
    });
    this.stale = options?.stale;
  }
}
```

## Bulk Delete Mutations

If a bulk delete can be blocked by business rules, send the whole selection to one API route and let the server validate + mutate inside one transaction.

```ts
// ✓ Correct — one request, atomic server-side validation
await fetch("/api/customers", {
  method: "DELETE",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ids }),
});
```

Avoid issuing one `DELETE` per id from the client. If one request fails after another already succeeded, the UI can report a failure even though some rows were already deleted.

## Calendar Date Validation

Regex-only checks are not enough for date strings. Validate the format and the calendar date before writing to Postgres so impossible values return a field error instead of a database 500.

```ts
const isValidIsoDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};
```

## Soft Delete Guard

Before allowing an update to a master data record, verify it hasn't been soft-deleted:

```ts
const item = await getItemById(id);
if (!item || item.deletedAt !== null) {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
```

Never allow updates or re-activations of soft-deleted master data via API.

## TanStack Query — Keys

All query keys come from the `queryKeys` factory in `lib/client/query-keys.ts` —
inline key arrays are blocked by lint. Add new families there.

```ts
import { queryKeys } from "@/lib/client/query-keys";

queryKeys.salesOrders.root        // ["sales-orders"] — list
queryKeys.salesOrders.detail(id)  // ["sales-orders", id] — extends the root,
                                  // so invalidating the root refreshes details
```

Detail keys nest under their list root. Card read-models (`itemCards`,
`customers.card`) are separate roots — they are draft-save surfaces with their
own `setQueryData` flows.

## TanStack Query — Mutations

Network calls go through `apiJson` (`lib/client/api.ts`); never hand-roll
`fetch` + `res.ok` + error parsing. Mutations whose success step is
"invalidate, then maybe a callback" use `useApiMutation`:

```ts
import { apiJson } from "@/lib/client/api";
import { queryKeys } from "@/lib/client/query-keys";
import { useApiMutation } from "@/lib/client/use-api-mutation";

const mutation = useApiMutation({
  mutationFn: (data: CreateItem) =>
    apiJson<{ id: string }>("/api/items", {
      method: "POST",
      body: data,
      fallbackError: "Failed to create item.",
    }),
  invalidates: [queryKeys.items.root],
  onSuccess: () => router.back(),
});
```

- Use `mutation.isPending` for loading state
- Plain `useMutation` is for genuinely different success handling (optimistic
  updates with rollback, sequencing) — still with factory keys

## Canonical References

- API handler wrapper: `lib/api/handler.ts`
- Example editable card: `app/(dashboard)/inventory/materials/[id]/material-card.tsx`
- Example API routes: `app/api/items/`
