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

Define policies in schema files, but still patch generated SQL when needed for repo requirements such as `FORCE ROW LEVEL SECURITY`, schema grants, or sequences. See the manufacturing and sales migrations for the current pattern.

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
| Purchase order lines | Hard delete + replace on draft edits |
| Purchase orders | Soft delete on `draft`, `received`, or `cancelled` only |
| Manufacturing orders | Soft delete on `draft`, `completed`, or `cancelled` only |
| Manufacturing ingredient rows | Hard delete + replace on draft edits |

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

### Manufacturing Orders

Manufacturing uses a header/ingredient snapshot split:

- `manufacturing.manufacturing_orders` stores the order header, workflow state, product snapshots, optional sales traceability, and actual cost rollups
- `manufacturing.manufacturing_order_ingredients` stores copied ingredient snapshots plus planned and actual quantities
- `salesOrderLineId` is stored as a plain UUID snapshot reference, not an FK, because draft sales-order edits replace line rows

Draft manufacturing edits replace ingredient rows in one transaction:

- update the header
- delete existing ingredient rows
- insert the recalculated snapshot rows

Released manufacturing orders are the only source for `items.expectedQty`. Recompute from the database after every release, completion, or cancellation; never apply deltas directly.

Completion consumes ingredient lots FIFO and records stock movement metadata:

- `movementType = manufacturing_consumed` for ingredient deductions
- `movementType = manufacturing_produced` for the finished-product lot
- `referenceType = manufacturing_order` and `referenceId = <mo id>` for traceability

## Concurrent Stock Writes

Use Postgres row locks to serialize stock-facing writes for the same item.

- Lock affected `inventory.items` rows in a stable sorted order before mutating lot stock, `items.committedQty`, or `items.expectedQty`.
- Lock workflow rows with `FOR UPDATE` before decisions that depend on current state, such as order status transitions or absolute stock-target edits.
- FIFO consumption must lock candidate `inventory.lots` rows with `FOR UPDATE` before reading balances.
- Warning and shortage checks must read after those locks are acquired.
- Keep recompute helpers database-derived. Lock first, then aggregate, then write the cached field.
- Keep the existing transaction wrapper. We do not use `SERIALIZABLE`, advisory locks, or trigger-based cache maintenance in v1.

This prevents read-modify-write races like:

1. transaction A reads the same lots as transaction B
2. both compute deductions in JS
3. both write back stale balances or stale cached totals

Canonical pattern:

```ts
const [order] = await tx
  .select({ status: manufacturingOrders.status })
  .from(manufacturingOrders)
  .where(eq(manufacturingOrders.id, id))
  .for("update")

await lockItemsInTx(tx, affectedItemIds)

const availableLots = await tx
  .select({
    id: lots.id,
    quantity: lots.quantity,
  })
  .from(lots)
  .where(and(eq(lots.itemId, itemId), sql`${lots.quantity} > 0`))
  .orderBy(asc(lots.receivedAt), asc(lots.id))
  .for("update", { of: lots })

await tx
  .update(lots)
  .set({
    quantity: sql`${lots.quantity} - ${deduct}`,
    updatedAt: new Date(),
  })
  .where(and(eq(lots.id, lotId), sql`${lots.quantity} >= ${deduct}`))
```

## Purchasing

Purchasing uses the same header/line snapshot pattern as sales and manufacturing:

- `purchasing.purchase_orders` stores the order header, supplier snapshot, workflow state, and total
- `purchasing.purchase_order_lines` stores copied material snapshots plus ordered, received, and cost fields
- editing a draft purchase order hard-deletes existing lines, then inserts the fresh snapshot set

Status and inventory rules:

- `draft` orders are editable and do not affect inventory aggregates
- `ordered` and `partial` orders contribute remaining quantity to `items.expectedQty`
- `received` and `cancelled` orders are terminal historical states
- receiving creates positive lots and `inventory.stock_movements` rows with `movementType = purchase_received`, `referenceType = purchase_order`, and `referenceId = <po id>`

`items.expectedQty` is shared inbound supply:

- released manufacturing orders contribute finished-product planned quantity
- ordered and partially received purchase orders contribute material remaining quantity
- always recompute from the database after submit, receive, cancel, release, complete, or manufacturing cancellation
- never increment/decrement `expectedQty` directly

## Stocktakes

Stocktakes are inventory-native snapshot rows:

- `inventory.stocktakes` stores the header, scope, and workflow state
- `inventory.stocktake_items` stores copied item snapshots plus `expectedQty`, `countedQty`, `varianceQty`, and `appliedDeltaQty`

Workflow rules:

- `draft` stocktakes are editable and block item soft deletes
- saving counts updates snapshot rows only; it must not mutate live stock
- completing a stocktake applies deltas from current live stock to counted truth and writes `stocktake_adjustment` movements with `referenceType = stocktake`
- if current live stock differs from the original snapshot `expectedQty`, completion returns `409` until the caller confirms the stale apply
- `cancelled` stocktakes keep history and do not mutate stock

Positive stock writes must always have a lot cost:

- purchase receipts use the PO line unit cost
- manufacturing output uses the computed actual cost per unit
- manual adjustments and positive stocktake deltas derive cost from the current item:
  - materials use `defaultPurchasePrice`
  - products derive cost from active BOM ingredients recursively
- if no cost basis exists, fail the write instead of creating a null-cost lot

This keeps future FIFO allocations from being consumed at zero cost.

## Numeric Fields

Postgres `numeric` columns are returned as **strings** by the driver (e.g. `"1.5"`, `"0"`). Always parse them:

```ts
// ✓ Correct — handles "0" (falsy string) correctly
const qty = parseFloat(row.quantity);
if (qty != null && !isNaN(qty)) { ... }

// ✗ Wrong — "0" is falsy, this incorrectly treats 0 as missing
if (row.quantity) { ... }
```

For API-backed reads, do not expose fixed-scale strings like `"5.0000"` from DAL queries. Canonicalize numeric strings in the select projection with `trimScale()` / `trimScaleNullable()` from `lib/db/numeric.ts`:

```ts
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";

quantity: trimScale(lots.quantity).as("quantity"),
costPerUnit: trimScaleNullable(lots.costPerUnit).as("costPerUnit"),
stock: trimScale(sql`COALESCE(SUM(${lots.quantity}), 0)`).as("stock"),
```

Use this for:

- raw numeric columns returned to the app/API
- nullable numeric columns returned to the app/API
- aggregate/subquery numeric expressions returned to the app/API

Keep write normalization unchanged. Stored `numeric` values stay exact; read-time trimming only changes the serialized string form.

## Count-Based Units

The shared unit picker is built from `lib/units-of-measure.ts`. Packaging and internal assemblies sometimes need count semantics even when no convert-library mass/volume unit fits.

Use the shared `Each` unit for:

- blank bags
- stickers
- generic totes
- internal packaged assemblies
- internal packs that are staged and consumed as discrete units

```ts
{ name: "Each", size: "1", uom: "ea" }
```

Do not fake these as pounds or cubic feet just to satisfy the unit picker. If a new onboarding or workflow needs count-based inventory, add `ea` to the shared unit options instead of inventing a one-off workaround in a script.

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

When a module generates human-readable document numbers with `nextval()` in the DAL, patch the migration SQL to create and grant the backing sequence explicitly. Drizzle does not currently keep these sequence definitions in the schema files we use for sales/manufacturing/purchasing, so the SQL migration is the source of truth.

```sql
CREATE SEQUENCE "purchasing"."order_number_seq";
GRANT USAGE, SELECT ON SEQUENCE "purchasing"."order_number_seq" TO app_user;
```

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
