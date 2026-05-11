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

The `system` schema (Better Auth tables) must **never** have RLS enabled, but `app_user` still needs `USAGE` on the schema plus CRUD on its tables because the normal app runtime and Better Auth both use `DATABASE_URL_APP`.

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

## Date and Time Model

Use two separate models:

- `*At` fields are exact instants, such as `createdAt`, `receivedAt`, `shippedAt`, `completedAt`, and `occurredAt`.
- `*Date` fields are business calendar dates, such as `shipDate`, `plannedDate`, `expectedDate`, and `requestedDate`.

Instant columns use `timestamptz` through Drizzle:

```ts
createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
```

Business date columns use Postgres `date` and TypeScript strings:

```ts
shipDate: date("ship_date", { mode: "string" })
```

Do not model business dates as UTC-midnight timestamps. A ship date of `2026-05-10` is not `2026-05-10T00:00:00.000Z`; it is just the calendar date `2026-05-10`.

Formatting rules:

- `formatDate(value)` is only for `YYYY-MM-DD` business dates. It does not use JS `Date` and does not timezone-convert.
- `formatDateTime(value, organizationTimeZone)` is only for exact instants. It requires an explicit IANA timezone.
- Operational ERP timestamps display in the organization timezone by default.
- Personal/session/security timestamps may use browser/user timezone only when explicitly intended.

Defaulting rules:

- Use `todayInTimeZone(organizationTimeZone)` for default business dates when current local business day matters.
- Use `new Date()` for true instant writes.

Migration rule for legacy naive ERP timestamps:

```sql
ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
```

Before applying that migration to production, verify `SHOW timezone;` and representative timestamp rows. The migration assumes existing naive values represent UTC wall-clock instants.

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

Manufacturing now uses a header/ingredient/batch/allocation split:

- `manufacturing.manufacturing_orders` stores the order header, workflow state, product snapshots, optional sales traceability, and actual cost rollups
- `manufacturing.manufacturing_order_ingredients` stores copied ingredient snapshots plus planned, picked, and actual quantities
- `manufacturing.manufacturing_order_batches` stores execution batches for batch-mode orders
- `manufacturing.manufacturing_pick_allocations` stores the FIFO lot allocations captured at pick time
- `salesOrderLineId` is stored as a plain UUID snapshot reference, not an FK, because draft sales-order edits replace line rows

Draft manufacturing edits still replace ingredient rows in one transaction:

- update the header
- delete existing ingredient rows
- insert the recalculated snapshot rows

Release behavior:

- discrete orders keep the template ingredient rows as the execution rows
- batch-mode orders create batch rows and replace the template ingredient rows with one set of batch-specific ingredient rows per batch

Released manufacturing orders contribute to the expected-supply projection, but batch-mode orders contribute only unfinished planned output.

Inventory effects are now split between pick and produce:

- `manufacturing_ingredient_consumption` events for ingredient deductions at pick time
- `manufacturing_output` for the finished-product lot
- `reservation_increase` / `reservation_release` for ingredient reservations
- `expected_increase` / `expected_release` for output-side expected supply

Discrete completion must reuse persisted pick allocations and must not deduct ingredient stock a second time. Batch-mode completion uses the batch’s pick allocations and creates one finished lot per completed batch.

## Concurrent Stock Writes

Use Postgres row locks to serialize stock-facing writes for the same item.

- Lock affected `inventory.items` rows in a stable sorted order before mutating lot stock or inventory projections.
- Lock workflow rows with `FOR UPDATE` before decisions that depend on current state, such as order status transitions or absolute stock-target edits.
- FIFO consumption must lock candidate `inventory.lots` rows with `FOR UPDATE` before reading balances.
- Warning and shortage checks must read after those locks are acquired.
- Keep inventory writes inside the kernel transaction. Lock first, write ledger events, then flush projection deltas.
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

## Inventory Kernel Verification Workflow

For any change that touches:

- stock mutations
- reservations / committed supply
- expected supply
- inventory ledger / projections
- inventory-affecting API routes or DAL functions

use this workflow before calling the change done:

1. Run the normal fast lane: `pnpm test`
2. Run the affected slow domain specs:
   - inventory: `pnpm test:e2e:inventory:slow`
   - purchasing: `pnpm test:e2e:purchasing:slow`
   - manufacturing: `pnpm test:e2e:manufacturing:slow`
   - sales: `pnpm test:e2e:sales:slow`
   - stocktake: `pnpm test:e2e:stocktake:slow`
   - cross-domain inventory work: `pnpm test:e2e:slow`
3. Run `pnpm verify:inventory`

`pnpm verify:inventory` is the standard post-test inventory integrity check:

- `pnpm verify:inventory-kernel` makes sure old direct stock helpers and removed truth fields do not leak back into active code
- `pnpm verify:inventory-state` diffs ledger-derived balances against stored projections for the current Playwright test org from `test/.test-env.json`

Run `pnpm verify:inventory` after the tests you want to validate. It depends on the latest Playwright global setup having refreshed `test/.test-env.json`.

## Inventory Disposition

Inventory lot balances include disposition as part of their grain:

```text
organizationId + itemId + locationId + lotId + disposition
```

V1 dispositions are `available`, `blocked`, and `rejected`.

Physical on-hand and `lots.quantity` include every disposition. Available stock, ATP, FIFO consumption, sales shipment, and manufacturing material picking use only `available` lot balances. Blocked and rejected stock remains physically visible but cannot be promised or consumed by normal flows.

Purchase receipts and manufacturing output may create `available` or `blocked` stock. Disposition decisions use kernel operations, not direct quantity mutation:

- `quality_disposition_change` moves quantity between lot-balance disposition buckets.
- `quality_scrap` removes physical quantity from a specific disposition bucket.
- `quality_disposition_events` records the decision and links back to the inventory event.

Mobile-facing stock writes must carry idempotency keys so retries do not duplicate receipts, releases, rejects, or scrap.

## Purchasing

Purchasing uses the same header/line snapshot pattern as sales and manufacturing:

- `purchasing.purchase_orders` stores the order header, supplier snapshot, workflow state, and total
- `purchasing.purchase_order_lines` stores copied material snapshots plus ordered, received, and cost fields
- editing a draft purchase order hard-deletes existing lines, then inserts the fresh snapshot set

Status and inventory rules:

- `draft` orders are editable and do not affect inventory aggregates
- `ordered` and `partial` orders contribute remaining quantity to the expected-supply projection
- `received` and `cancelled` orders are terminal historical states
- receiving creates positive lots plus `purchase_receipt` and matching `expected_release` events

Expected supply is shared inbound supply:

- released manufacturing orders contribute finished-product planned quantity
- ordered and partially received purchase orders contribute material remaining quantity
- these paths must go through the kernel expected-supply operations
- never increment/decrement expected supply directly outside the kernel

## Stocktakes

Stocktakes are inventory-native snapshot rows:

- `inventory.stocktakes` stores the header, scope, and workflow state
- `inventory.stocktake_items` stores copied item snapshots plus `expectedQty`, `countedQty`, `varianceQty`, and `appliedDeltaQty`

Workflow rules:

- `draft` stocktakes are editable and block item soft deletes
- saving counts updates snapshot rows only; it must not mutate live stock
- completing a stocktake applies deltas from current live stock to counted truth and writes `stocktake_gain`, `stocktake_loss`, or `stocktake_verification` events
- if current live stock differs from the original snapshot `expectedQty`, completion returns `409` until the caller confirms the stale apply
- `cancelled` stocktakes keep history and do not mutate stock

Positive stock writes must always have a lot cost:

- purchase receipts use the PO line unit cost
- manufacturing output uses the computed actual cost per unit
- manual adjustments and positive stocktake deltas derive cost from the current item:
  - materials use `currentStockUnitCost`, falling back to `defaultPurchasePrice / purchaseToStockFactor`
  - products derive cost from active BOM ingredients recursively
- if no cost basis exists, fail the write instead of creating a null-cost lot

This keeps future FIFO allocations from being consumed at zero cost.

## Inventory Ledger and Projections

Inventory truth now lives in:

- `inventory.inventory_events` — append-only ledger
- `inventory.inventory_lot_balances` — hot-path lot projection
- `inventory.inventory_item_balances` — hot-path item projection
- `inventory.inventory_reservations_summary` — open reservation rows
- `inventory.inventory_expected_summary` — open expected-supply rows

The kernel is the only write path for stock, reservations, expected supply, and cost-bearing inventory events.

Active code must not:

- write `lots.quantity` directly
- maintain item-level committed/expected counters directly
- write ledger events or projections outside `lib/inventory/kernel/**`

Use projections for UI availability reads and workflow decisions. Use ledger queries for audit history and reconciliation.

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
import { inventoryLotBalances } from "@/lib/db/schema";

quantity: trimScale(inventoryLotBalances.quantity).as("quantity"),
unitCost: trimScaleNullable(inventoryLotBalances.unitCost).as("unitCost"),
stock: trimScale(sql`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`).as("stock"),
```

Use this for:

- raw numeric columns returned to the app/API
- nullable numeric columns returned to the app/API
- aggregate/subquery numeric expressions returned to the app/API

Keep write normalization unchanged. Stored `numeric` values stay exact; read-time trimming only changes the serialized string form.

## Inventory Event Retention

`inventory.inventory_events` stays unpartitioned in v1.

Planning rule:

- treat it as the long-term audit table
- when row count or retention needs make it necessary, partition by `occurred_at`
- do not add ad hoc archive tables for post-cutover inventory truth

Pre-cutover history can stay in `inventory.stock_movements_archive`, but all new inventory truth belongs in `inventory.inventory_events`.

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

```bash
pnpm db:generate            # generates SQL migration file (wraps drizzle-kit + idempotency rewriter)
pnpm drizzle-kit migrate    # applies pending migrations
```

**Never use `drizzle push`** — it bypasses the migration file system and causes drift.

**Never run `drizzle-kit generate` directly.** `pnpm db:generate` chains it with `scripts/make-migrations-idempotent.ts`, which adds `IF NOT EXISTS` / `DROP IF EXISTS` guards. Drizzle has no built-in flag for this. CI rejects non-idempotent migrations.

When a module generates human-readable document numbers with `nextval()` in the DAL, patch the migration SQL to create and grant the backing sequence explicitly. Drizzle does not currently keep these sequence definitions in the schema files we use for sales/manufacturing/purchasing, so the SQL migration is the source of truth.

```sql
CREATE SEQUENCE "purchasing"."order_number_seq";
GRANT USAGE, SELECT ON SEQUENCE "purchasing"."order_number_seq" TO app_user;
```

## Local Worktree Database Workflow

Local development defaults to one shared local Postgres instance and one database per worktree.

Default flow:

```bash
pnpm db:local:setup
```

`pnpm db:local:setup`:

- auto-starts the shared local Postgres container if it is not already running
- derives a database name from the current worktree folder
- creates the database if needed
- creates or updates `app_user`
- writes worktree-local `DATABASE_URL` and `DATABASE_URL_APP` into `.env.local`
- runs `pnpm drizzle-kit migrate`

Worktrees still fall back to the repo-root `.env.local` for shared settings like auth secrets and app URLs, but they do **not** inherit `DATABASE_URL` or `DATABASE_URL_APP` from it. This prevents a new worktree from silently pointing migrations at a shared remote Neon branch.

Cleanup flow after merge:

```bash
gh pr merge <pr> --merge
git push origin --delete <branch>
pnpm worktree:cleanup <branch>
```

Run it from the repo root.

Do not use `gh pr merge --delete-branch` from a feature worktree. GitHub CLI may try to delete or switch the local branch and fail because the repo root already holds the `main` worktree.

`pnpm worktree:cleanup <branch>`:

- resolves the matching worktree from the branch name
- refuses to remove a dirty worktree
- drops that worktree's local database
- removes the worktree
- deletes the local branch when possible
- stops the shared Docker Postgres container when no linked worktrees remain

Data persists across `pnpm db:local:stop` because the Docker Postgres service uses a named volume. You do not need to reseed every time you start it.

Each worktree still gets its own database. `pnpm db:local:setup` derives the database name from the worktree path and writes that database URL into the worktree `.env.local`. For a brand-new worktree DB, run the dev server and then `pnpm dev:seed-user` once; it creates `test@test.com` in fake org `test-paonia-soil-co` and idempotently loads Paonia-style catalog and 2026 sales data there.

If you already run Postgres outside Docker, set `LOCAL_DB_ADMIN_URL` before `pnpm db:local:setup`:

```bash
LOCAL_DB_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres pnpm db:local:setup
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
