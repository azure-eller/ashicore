---
read_when:
  - Writing or editing a Drizzle schema
  - Writing or editing a DAL query function
  - Working with Zod schemas in lib/schemas/
  - Running migrations
  - Debugging RLS or org isolation issues
  - Handling nullable or numeric fields
---

# Database Patterns

## DAL Rule

Never import `db` directly in pages, components, or API routes. All database access goes through DAL query functions.

All DAL query functions use `withAuthedOrgContext`:

```ts
import { withAuthedOrgContext } from "@/lib/dal/auth";

export async function getItems(type: ItemType) {
  return withAuthedOrgContext(async (tx) => {
    return tx.select().from(items).where(
      and(isNull(items.deletedAt), eq(items.type, type))
    );
  });
}
```

Never call `getAuthedContext()` directly in query functions — `withAuthedOrgContext` handles auth internally.

## Row Level Security (RLS)

All non-system tables (inventory schema and any future schemas) **must** have RLS enabled.

Define RLS in the schema file using `pgPolicy` + `.enableRLS()`:

```ts
export const items = pgTable("items", { ... })
  .enableRLS();

export const itemsOrgPolicy = pgPolicy("items_org_policy", {
  for: "all",
  using: sql`organization_id::text = current_setting('app.current_org_id', true)`,
});
```

`true` in `current_setting('app.current_org_id', true)` means: return NULL (not an error) when the setting is unset. NULL ≠ any org ID, so all rows are blocked — **fail-closed**.

**Never** define RLS in hand-written migration SQL files. See `lib/db/schema/items.ts` for the canonical pattern.

The `system` schema (Better Auth tables) must **never** have RLS enabled.

## Org Scoping in Queries

RLS handles org isolation automatically via the `app.current_org_id` session variable. **Do not add `WHERE organizationId = ?` clauses** for org filtering in read, update, or delete queries — it's redundant and couples the query to org logic unnecessarily.

**Exception — CREATE queries**: explicitly pass `organizationId` as a column value in the inserted row:

```ts
// ✓ Create — pass orgId explicitly for the new row value
await tx.insert(items).values({ ...data, organizationId: orgId });

// ✓ Read — RLS handles org scoping, no WHERE needed
await tx.select().from(items).where(isNull(items.deletedAt));

// ✗ Wrong — redundant WHERE on reads
await tx.select().from(items).where(
  and(eq(items.organizationId, orgId), isNull(items.deletedAt))
);
```

## Soft Deletes

| Table type | Delete strategy |
|------------|----------------|
| Master data (items, units, customers, suppliers) | Soft delete: `deletedAt = new Date()` |
| Line / detail tables (BOM lines) | Hard delete |
| Sales order lines | Hard delete + replace on draft edits |

Filter soft-deleted records with `isNull`:

```ts
.where(isNull(items.deletedAt))
```

Never hard-delete master data via API.

### Sales Order Lines

Sales order lines follow the same replace-in-transaction pattern as BOM rows:

- editing a draft order deletes all existing lines, then inserts the fresh set
- deleting an order soft-deletes only the order row; the saved lines remain attached to that order for history
- committed quantity calculations ignore soft-deleted orders

## Numeric Fields

Postgres `numeric` columns are returned as **strings** by the driver (e.g. `"1.5"`, `"0"`). Always parse them:

```ts
// ✓ Correct — handles "0" (falsy string) correctly
const qty = parseFloat(row.quantity);
if (qty != null && !isNaN(qty)) { ... }

// ✗ Wrong — "0" is falsy, this incorrectly treats 0 as missing
if (row.quantity) { ... }
```

## Zod Schemas

One Zod schema per entity in `lib/schemas/`, derived from the Drizzle table:

```ts
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { items } from "@/lib/db/schema/items";

export const insertItemSchema = createInsertSchema(items);
export const selectItemSchema = createSelectSchema(items);
```

Extend with `.extend()` or `.omit()` as needed for create/edit forms.

### Nullable string fields

All optional text fields must use this pattern:

```ts
const nullableString = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v != null ? v.trim() || null : null));
```

This accepts `string`, `null`, OR `undefined` and normalizes the output to `string | null`. Forms send `undefined` for fields the user never touched. Without `.optional()`, the schema rejects `undefined` and the form silently fails to submit.

Always pair this with explicit `null` defaults in react-hook-form:

```ts
defaultValues: {
  sku: null,           // ✓ explicit null — Zod sees null, passes
  // sku: (missing)    // ✗ Zod sees undefined, rejects without .optional()
}
```

## Schema Naming

- Database columns: `snake_case`
- TypeScript (Drizzle mapped): `camelCase`
- Drizzle handles the mapping automatically

## Migrations

Always generate then apply:

```bash
pnpm drizzle-kit generate   # generates SQL migration file
pnpm drizzle-kit migrate    # applies pending migrations
```

**Never use `drizzle push`** — it bypasses the migration file system and can cause drift.

## Partial Unique Indexes

Use `where` on the index for conditional uniqueness (e.g. SKU must be unique per org, but only when not deleted and not null):

```ts
export const itemSkuIdx = uniqueIndex("items_sku_idx")
  .on(items.organizationId, items.sku)
  .where(sql`sku IS NOT NULL AND deleted_at IS NULL`);
```

## Canonical References

- Schema pattern (RLS, policies): `lib/db/schema/items.ts`
- DAL auth wrapper: `lib/dal/auth.ts`
- Org context setter: `lib/db/with-org-context.ts`
- All inventory DAL queries: `app/(dashboard)/inventory/queries.ts`
