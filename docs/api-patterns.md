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
