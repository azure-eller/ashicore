# Lot Tracking Design

## Problem

Inventory stock (`inStock`) is stored directly on the items table as a single number. This means no visibility into where stock came from, what it cost, or which stock to use first. Adding lot tracking makes stock traceable and sets the foundation for stock adjustments, purchase orders, and cost accounting.

## Decisions

- **Everything is lot-tracked.** Every item (material or product) gets a default lot on creation. No "does this item use lots?" branching.
- **Lots are the single source of truth for stock.** The `inStock` column is dropped from items and computed as `SUM(lots.quantity)` via a subquery helper in the DAL.
- **FIFO ordering.** Lots are ordered by `receivedAt` ascending. Oldest stock is used first. Allocation logic is deferred to the stock adjustments feature — nothing calls it yet.
- **Sequential lot numbers.** Format: `LOT-000001`, `LOT-000002`, etc. Generated per-org inside the creation transaction. The unique index on `(organizationId, lotNumber)` catches any race condition — if two transactions collide, the second gets a unique constraint error and should retry.
- **No special "default" lot.** The auto-created lot is just `LOT-000001`. No flags, no special casing.
- **Minimal UI.** Lots visible as a read-only table on the item detail page. No lot creation, editing, or deletion UI. Lots are only created programmatically (item creation, and later POs/stock adjustments).

## Schema

### `lots` table

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK, default random |
| `organizationId` | text | NOT NULL, RLS |
| `itemId` | UUID | NOT NULL, FK → items |
| `lotNumber` | varchar(20) | NOT NULL |
| `quantity` | numeric(12,4) | NOT NULL, default 0 |
| `costPerUnit` | numeric(10,4) | nullable |
| `receivedAt` | timestamp | NOT NULL, default now() |
| `createdAt` | timestamp | NOT NULL, default now() |
| `updatedAt` | timestamp | NOT NULL, default now() |

**Indexes:**
- Unique: `(organizationId, lotNumber)` — lot numbers unique per org
- Index: `(itemId)` — fast lookup by item
- RLS policy: `organization_id = current_setting('app.current_org_id', true)`

### Items table changes

- **Drop** `inStock` column
- `committedQty`, `expectedQty`, `safetyStock` remain (future features will derive these similarly)

### Computed stock

A shared DAL helper `withInStock` appends a correlated subquery:

```sql
(SELECT COALESCE(SUM(quantity), 0) FROM inventory.lots WHERE inventory.lots.item_id = inventory.items.id) AS in_stock
```

The subquery must use the `inventory` schema prefix since all tables are in `inventorySchema`. In Drizzle, this will reference the `lots` table object directly rather than raw SQL table names.

No database view. The subquery is inlined by Postgres's query planner — same performance, simpler setup. Can be promoted to a view or materialized view later if needed.

## Data Flow

### Item creation

1. User submits material form (name, unit, initial stock, price, etc.)
2. The form schema keeps an `initialStock` field (replaces `inStock`). This field is consumed by the API route but not stored on the item.
3. API handler wraps everything in a single transaction:
   a. Insert item row (no `inStock` column — `initialStock` is stripped from the payload before insert)
   b. Generate lot number: `SELECT MAX(lot_number) FROM lots WHERE organization_id = ?`, increment. The unique index on `(organizationId, lotNumber)` guards against race conditions.
   c. Insert lot: `quantity` = `initialStock`, `costPerUnit` = `defaultPurchasePrice` (nullable if not provided)
4. Transaction commits atomically

### Inventory table query

- DAL `getItems` query uses `withInStock` subquery helper to append computed `inStock` to each row
- Table component receives `inStock` as before — no frontend changes. `ItemRow` type keeps `inStock: string`.

### Item detail query

- DAL `getItem` query also uses `withInStock` to include computed `inStock` on the detail page
- Both list and detail queries go through the same helper — single source of truth

### Item detail page

- Existing item info section unchanged (still shows `inStock` via computed value)
- New "Lots" section below: read-only table with columns:
  - Lot Number
  - Quantity
  - Cost / Unit (formatted with `Intl.NumberFormat`, or "—" if null)
  - Received (date)
- Sorted by `receivedAt` ascending (oldest first, reinforces FIFO mental model)
- Lots data fetched server-side in the page component alongside `getItem` (same pattern as existing data fetching)

## Files

### New

| File | Purpose |
|------|---------|
| `lib/db/schema/lots.ts` | Lots table schema with RLS |
| `drizzle/NNNN_*.sql` | Migration: create lots table, migrate existing `inStock` data into lots rows, drop `inStock` from items. Migration creates a default lot for each existing item with `in_stock > 0`. |

### Modified

| File | Change |
|------|--------|
| `lib/db/schema/items.ts` | Remove `inStock` column |
| `app/(dashboard)/inventory/queries.ts` | Add `withInStock` subquery helper, update list query, add `getLots(itemId)`, add lot creation function |
| `app/(dashboard)/inventory/materials/[id]/page.tsx` | Add lots table section |
| `app/(dashboard)/inventory/materials/material-form.tsx` | Field name changes from `inStock` to `initialStock` |
| `app/api/items/route.ts` | Destructure `initialStock` from validated payload in the API route, pass remaining fields to `createItem`. Create item + default lot in single transaction. |
| `lib/schemas/items.ts` | Remove `inStock` (no longer a column). Add `initialStock` via `.extend({ initialStock: z.string().default("0") })` after the `.omit()` chain — this field is consumed by the API to create the default lot, not stored on the item. Omit `initialStock` from `updateItemSchema` (initial stock only applies at creation). |

### Not touched

| File | Why |
|------|-----|
| `columns.tsx`, `data-table.tsx` | Still receive `inStock` as a field — don't care where it comes from |
| Edit page | No lot editing UI in this version |

## What's deferred

- **FIFO allocation function** — no consumer until stock adjustments are built
- **Stock adjustments** — next feature (adds `stock_movements` table, "Adjust Stock" UI, lot quantity mutations)
- **Lot creation UI** — lots only created programmatically for now
- **Expiration tracking** — `expiresAt` column added when needed
- **Multi-location** — `locationId` on lots added when needed
- **Supplier lot numbers** — added when supplier/PO integration is built
