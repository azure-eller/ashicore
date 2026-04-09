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

Field-level validation errors (Zod failures):

```ts
const result = schema.safeParse(await req.json());
if (!result.success) {
  return NextResponse.json(
    { errors: result.error.flatten().fieldErrors },
    { status: 400 }
  );
}
```

Note: **`errors`** (plural) for field errors — this is what react-hook-form's `setError` expects.

## General Error Shape

Non-field errors (not found, forbidden, business logic failures):

```ts
return NextResponse.json({ error: "Not found" }, { status: 404 });
```

Note: **`error`** (singular) for general errors. Never use `errors` for non-field errors.

## Numeric Response Shape

API success payloads should return canonical numeric strings, not fixed Postgres scale. Keep exact decimals as strings, but trim trailing zeroes in DAL read selectors before the route calls `NextResponse.json(...)`.

```ts
quantity: trimScale(lots.quantity).as("quantity"),
totalAmount: trimScale(salesOrders.totalAmount).as("totalAmount"),
```

Do not coerce exact decimals to JS `number` in API responses.

## Domain Errors

API-facing business errors with shared JSON response behavior should extend `DomainError` from `lib/errors/domain-error.ts` instead of re-implementing `status` and `toResponse()`.

- Put field validation failures in `errors`
- Put domain-specific warning payloads in `extra`
- `toResponse()` returns `{ errors }` for field errors, otherwise `{ error, ...extra }`

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

Standard key pattern: `["entity", filterOrId]`

```ts
// List queries
["items", "material"]    // all materials
["items", "product"]     // all products
["units"]                // all units

// Single item queries
["items", id]            // specific item by ID
```

## TanStack Query — Mutations

```ts
const mutation = useMutation({
  mutationFn: async (data) => {
    const res = await fetch("/api/items", { method: "POST", body: JSON.stringify(data) });
    if (!res.ok) throw await res.json();
    return res.json();
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["items"] });
    router.back();
  },
});
```

- Use `mutation.isPending` for loading state
- No optimistic updates
- Invalidate the relevant query key(s) on success

## Canonical References

- API handler wrapper: `lib/api/handler.ts`
- Example mutation form: `app/(dashboard)/inventory/materials/material-form.tsx`
- Example API routes: `app/api/items/`
