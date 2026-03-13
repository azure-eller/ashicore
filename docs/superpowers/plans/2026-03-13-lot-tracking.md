# Lot Tracking Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make lots the single source of truth for inventory stock, replacing the `inStock` column on items with computed values from a new `lots` table.

**Architecture:** New `lots` table in the `inventory` schema with RLS. `inStock` is dropped from items and computed via a DAL subquery helper (`withInStock`). Item creation auto-generates a default lot. The material detail page shows a read-only lots table.

**Tech Stack:** Drizzle ORM, Neon Postgres, Next.js App Router (server components), Zod, react-hook-form

---

## File Structure

| File | Responsibility |
|------|---------------|
| `lib/db/schema/lots.ts` | **NEW** — Lots table definition with RLS, indexes, FK to items |
| `lib/db/schema/index.ts` | **MODIFY** — Re-export lots schema |
| `lib/db/schema/items.ts` | **MODIFY** — Remove `inStock` column |
| `lib/schemas/items.ts` | **MODIFY** — Replace `inStock` with `initialStock` via `.extend()`, update `updateItemSchema` omit |
| `app/(dashboard)/inventory/queries.ts` | **MODIFY** — Add `withInStock` subquery, update `getItems`/`getItem`, add `getLots`, add `createItemWithLot` |
| `app/api/items/route.ts` | **MODIFY** — Destructure `initialStock`, call `createItemWithLot` |
| `app/(dashboard)/inventory/materials/material-form.tsx` | **MODIFY** — Rename `inStock` field to `initialStock` |
| `app/(dashboard)/inventory/materials/[id]/page.tsx` | **MODIFY** — Fetch and display lots table |
| `scripts/seed.ts` | **MODIFY** — Remove `inStock` from item inserts, add lot creation after items |

---

## Chunk 1: Schema & Migration

### Task 1: Create lots table schema

**Files:**
- Create: `lib/db/schema/lots.ts`
- Modify: `lib/db/schema/index.ts`

- [ ] **Step 1: Create `lib/db/schema/lots.ts`**

```typescript
import {
  uuid,
  varchar,
  text,
  numeric,
  timestamp,
  pgPolicy,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { inventorySchema } from "./units";
import { items } from "./items";

export const lots = inventorySchema
  .table(
    "lots",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      itemId: uuid("item_id")
        .notNull()
        .references(() => items.id),
      lotNumber: varchar("lot_number", { length: 20 }).notNull(),
      quantity: numeric("quantity", { precision: 12, scale: 4 })
        .notNull()
        .default("0"),
      costPerUnit: numeric("cost_per_unit", { precision: 10, scale: 4 }),
      receivedAt: timestamp("received_at").notNull().defaultNow(),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      uniqueIndex("lots_org_lot_number_uidx").on(
        table.organizationId,
        table.lotNumber
      ),
      index("lots_item_id_idx").on(table.itemId),
      pgPolicy("lots_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
```

- [ ] **Step 2: Add lots export to `lib/db/schema/index.ts`**

Add this line after the existing exports:

```typescript
export * from "./lots";
```

- [ ] **Step 3: Commit**

```bash
git add lib/db/schema/lots.ts lib/db/schema/index.ts
git commit -m "feat: add lots table schema with RLS"
```

### Task 2: Remove `inStock` from items schema and update Zod schemas

**Files:**
- Modify: `lib/db/schema/items.ts`
- Modify: `lib/schemas/items.ts`

- [ ] **Step 1: Remove `inStock` column from `lib/db/schema/items.ts`**

Remove this line from the items table definition:

```typescript
inStock: numeric("in_stock", { precision: 12, scale: 4 }).notNull().default("0"),
```

- [ ] **Step 2: Update `lib/schemas/items.ts`**

Replace the entire file with:

```typescript
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { items } from "@/lib/db/schema";

const nullableString = z
  .string()
  .nullable()
  .transform((v) => (v != null ? v.trim() || null : null));

export const insertItemSchema = createInsertSchema(items, {
  name: z.string().min(1, "Name is required"),
  itemType: z.enum(["product", "material"]),
  unitDefinitionId: z.string().min(1, "Unit is required"),
  sku: nullableString,
  category: nullableString,
  defaultPurchasePrice: nullableString,
  description: nullableString,
}).omit({
  id: true,
  organizationId: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  committedQty: true,
  expectedQty: true,
  safetyStock: true,
  defaultSellingPrice: true,
}).extend({
  initialStock: z.string().default("0"),
});

// Update schema: itemType, unitDefinitionId are immutable after creation.
// initialStock only applies at creation (populates the default lot).
export const updateItemSchema = insertItemSchema.omit({
  itemType: true,
  unitDefinitionId: true,
  initialStock: true,
});

export type InsertItem = z.infer<typeof insertItemSchema>;
export type UpdateItem = z.infer<typeof updateItemSchema>;
```

Key changes:
- `inStock` no longer exists in `createInsertSchema` output (column dropped)
- `initialStock` added via `.extend()` — consumed by API route, not stored on item
- `updateItemSchema` omits `initialStock` instead of `inStock`

- [ ] **Step 3: Commit**

```bash
git add lib/db/schema/items.ts lib/schemas/items.ts
git commit -m "feat: drop inStock column, add initialStock to insert schema"
```

### Task 3: Generate and review migration

**Files:**
- Generated: `drizzle/0008_*.sql` (auto-generated name)

- [ ] **Step 1: Generate migration**

```bash
pnpm drizzle-kit generate
```

This should produce a migration that:
1. Creates the `inventory.lots` table
2. Drops `in_stock` from `inventory.items`

- [ ] **Step 2: Review the generated migration SQL**

Open the generated file and verify it contains:
- `CREATE TABLE inventory.lots` with all columns, constraints, and RLS policy
- `ALTER TABLE inventory.items DROP COLUMN in_stock`
- The unique index on `(organization_id, lot_number)`
- The index on `item_id`

If items with `in_stock > 0` exist in the database, manually add a data migration step **before** the DROP COLUMN:

```sql
INSERT INTO inventory.lots (id, organization_id, item_id, lot_number, quantity, cost_per_unit, received_at)
SELECT
  gen_random_uuid(),
  organization_id,
  id,
  'LOT-000001',
  in_stock,
  default_purchase_price,
  created_at
FROM inventory.items
WHERE in_stock > 0 AND deleted_at IS NULL;
```

- [ ] **Step 3: Apply migration**

```bash
pnpm drizzle-kit migrate
```

- [ ] **Step 4: Commit**

```bash
git add drizzle/
git commit -m "feat: migration to create lots table and drop inStock"
```

### Task 3b: Update seed script

**Files:**
- Modify: `scripts/seed.ts`

- [ ] **Step 1: Remove `inStock` from all item insert values**

Remove every `inStock: "..."` line from the items insert values (8 occurrences).

- [ ] **Step 2: Add lot creation after item insert**

After the `insertedItems` block, add lot creation. Store the original stock values and create lots:

```typescript
  // 4. Create default lots for each item
  const { lots } = await import("@/lib/db/schema");

  const stockAmounts: Record<string, string> = {
    "Sphagnum Peat Moss": "48",
    "Perlite": "120",
    "Compost": "30",
    "Pumice": "60",
    "Worm Castings": "500",
    "Premium Garden Mix": "200",
    "Raised Bed Blend": "15",
    "Seed Starting Mix": "85",
  };

  let lotSeq = 1;
  for (const item of insertedItems) {
    const qty = stockAmounts[item.name];
    if (qty) {
      await db.insert(lots).values({
        organizationId: orgId,
        itemId: item.id,
        lotNumber: `LOT-${String(lotSeq++).padStart(6, "0")}`,
        quantity: qty,
      }).onConflictDoNothing();
    }
  }
  console.log(`Created ${lotSeq - 1} default lots`);
```

- [ ] **Step 3: Commit**

```bash
git add scripts/seed.ts
git commit -m "fix: update seed script to create lots instead of inStock"
```

---

## Chunk 2: DAL Queries

### Task 4: Add `withInStock` subquery helper and update queries

**Files:**
- Modify: `app/(dashboard)/inventory/queries.ts`

- [ ] **Step 1: Add lots import and `inStockSubquery` helper**

At the top of `queries.ts`, add to the drizzle-orm import:

```typescript
import { and, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { items, unitDefinitions, lots } from "@/lib/db/schema";
```

After the imports, add the subquery helper:

```typescript
const inStockSubquery = sql<string>`(
  SELECT COALESCE(SUM(${lots.quantity}), 0)
  FROM ${lots}
  WHERE ${lots.itemId} = ${items.id}
)`.as("in_stock");
```

- [ ] **Step 2: Update `getItems` to use `inStockSubquery`**

Replace `inStock: items.inStock` with `inStock: inStockSubquery` in the select:

```typescript
export async function getItems(filters?: { itemType?: ItemType }): Promise<ItemRow[]> {
  return withAuthedOrgContext(async (tx) => {
    const conditions = [
      isNull(items.deletedAt),
      ...(filters?.itemType ? [eq(items.itemType, filters.itemType)] : []),
    ];

    const rows = await tx
      .select({
        id: items.id,
        name: items.name,
        sku: items.sku,
        itemType: items.itemType,
        inStock: inStockSubquery,
        unit: unitDefinitions.name,
        category: items.category,
      })
      .from(items)
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(...conditions));
    return rows as ItemRow[];
  });
}
```

- [ ] **Step 3: Update `getItem` to use `inStockSubquery`**

Replace `inStock: items.inStock` with `inStock: inStockSubquery` in the select:

```typescript
export async function getItem(id: string) {
  return withAuthedOrgContext(async (tx) => {
    const [row] = await tx
      .select({
        id: items.id,
        name: items.name,
        sku: items.sku,
        itemType: items.itemType,
        category: items.category,
        description: items.description,
        unitDefinitionId: items.unitDefinitionId,
        defaultPurchasePrice: items.defaultPurchasePrice,
        inStock: inStockSubquery,
        unitName: unitDefinitions.name,
        unitSize: unitDefinitions.size,
        unitUom: unitDefinitions.uom,
      })
      .from(items)
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(eq(items.id, id), isNull(items.deletedAt)));
    return row ?? null;
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add app/\(dashboard\)/inventory/queries.ts
git commit -m "feat: compute inStock from lots via subquery helper"
```

### Task 5: Add `getLots` and `createItemWithLot` DAL functions

**Files:**
- Modify: `app/(dashboard)/inventory/queries.ts`

- [ ] **Step 1: Add `getLots` query**

Add after the existing query functions:

```typescript
export async function getLots(itemId: string) {
  return withAuthedOrgContext(async (tx) => {
    return tx
      .select({
        id: lots.id,
        lotNumber: lots.lotNumber,
        quantity: lots.quantity,
        costPerUnit: lots.costPerUnit,
        receivedAt: lots.receivedAt,
      })
      .from(lots)
      .where(eq(lots.itemId, itemId))
      .orderBy(lots.receivedAt);
  });
}
```

- [ ] **Step 2: Add lot number generation helper**

Add a private helper function:

```typescript
async function generateLotNumber(tx: Tx, orgId: string): Promise<string> {
  const [result] = await tx
    .select({ maxLot: sql<string | null>`MAX(${lots.lotNumber})` })
    .from(lots)
    .where(eq(lots.organizationId, orgId));

  const current = result?.maxLot;
  if (!current) return "LOT-000001";

  const num = parseInt(current.replace("LOT-", ""), 10);
  return `LOT-${String(num + 1).padStart(6, "0")}`;
}
```

Import `Tx` type at the top — add to the existing import:

```typescript
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
```

- [ ] **Step 3: Add `createItemWithLot` function**

Replace the existing `createItem` function with `createItemWithLot`:

```typescript
export async function createItemWithLot(
  data: Omit<InsertItem, "initialStock">,
  initialStock: string,
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [item] = await tx
      .insert(items)
      .values({ ...data, organizationId: orgId })
      .returning({ id: items.id });

    const lotNumber = await generateLotNumber(tx, orgId);

    await tx.insert(lots).values({
      organizationId: orgId,
      itemId: item.id,
      lotNumber,
      quantity: initialStock,
      costPerUnit: data.defaultPurchasePrice ?? null,
    });

    return item;
  });
}
```

Remove the old `createItem` function entirely.

- [ ] **Step 4: Commit**

```bash
git add app/\(dashboard\)/inventory/queries.ts
git commit -m "feat: add getLots query and createItemWithLot with auto lot"
```

---

## Chunk 3: API & Form Updates

### Task 6: Update API route to use `createItemWithLot`

**Files:**
- Modify: `app/api/items/route.ts`

- [ ] **Step 1: Update POST handler**

```typescript
import { NextResponse } from "next/server";
import { getItems, createItemWithLot } from "@/app/(dashboard)/inventory/queries";
import { ITEM_TYPES, type ItemType } from "@/app/(dashboard)/inventory/types";
import { insertItemSchema } from "@/lib/schemas/items";
import { apiHandler } from "@/lib/api/handler";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("itemType");
  const itemType: ItemType | undefined =
    raw && (ITEM_TYPES as readonly string[]).includes(raw)
      ? (raw as ItemType)
      : undefined;
  const data = await getItems(itemType ? { itemType } : undefined);
  return NextResponse.json(data);
}

export const POST = apiHandler(async (request) => {
  const body = await request.json();
  const { initialStock, ...data } = insertItemSchema.parse(body);
  const item = await createItemWithLot(data, initialStock);
  return NextResponse.json(item, { status: 201 });
});
```

Key change: destructure `initialStock` from the parsed payload, pass `data` (without `initialStock`) to `createItemWithLot`.

- [ ] **Step 2: Commit**

```bash
git add app/api/items/route.ts
git commit -m "feat: API creates default lot on item creation"
```

### Task 7: Update material form field name

**Files:**
- Modify: `app/(dashboard)/inventory/materials/material-form.tsx`

- [ ] **Step 1: Update default values**

In the `useForm` call, change `inStock` to `initialStock` in the defaultValues:

```typescript
      : {
          name: "",
          itemType: "material" as const,
          unitDefinitionId: "",
          initialStock: "0",
        },
```

- [ ] **Step 2: Update Controller name**

Change the Controller `name` prop from `"inStock"` to `"initialStock"`:

```typescript
                  {!initialData && (
                    <Controller
                      name="initialStock"
                      control={form.control}
                      render={({ field, fieldState }) => (
```

- [ ] **Step 3: Build check**

```bash
pnpm build
```

Verify no type errors. The `initialData` prop still has `inStock: string` but that's only used for display — the form never writes back to it in edit mode (the field is hidden when `initialData` is present).

- [ ] **Step 4: Commit**

```bash
git add app/\(dashboard\)/inventory/materials/material-form.tsx
git commit -m "feat: rename form field from inStock to initialStock"
```

---

## Chunk 4: Lots UI on Detail Page

### Task 8: Display lots on material detail page

**Files:**
- Modify: `app/(dashboard)/inventory/materials/[id]/page.tsx`

- [ ] **Step 1: Add lots fetch and table**

```typescript
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getItem, getLots } from "@/app/(dashboard)/inventory/queries";
import { formatPrice } from "@/lib/format";

export default async function MaterialDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [item, itemLots] = await Promise.all([getItem(id), getLots(id)]);
  if (!item) redirect("/inventory/materials");

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Link
            href="/inventory/materials"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <span aria-hidden>←</span> Back to Materials
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            {item.name}
          </h1>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/inventory/materials/${id}/edit`}>Edit</Link>
        </Button>
      </div>
      <Separator />
      {item.description && (
        <p className="max-w-2xl text-sm text-muted-foreground">{item.description}</p>
      )}
      <dl className="grid max-w-2xl grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-medium text-muted-foreground">SKU</dt>
          <dd className="mt-1 text-sm">{item.sku ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            Category
          </dt>
          <dd className="mt-1 text-sm">{item.category ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Unit</dt>
          <dd className="mt-1 text-sm">
            {item.unitName} ({parseFloat(item.unitSize)} {item.unitUom})
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            Purchase Price
          </dt>
          <dd className="mt-1 text-sm">
            {formatPrice(item.defaultPurchasePrice) ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            In Stock
          </dt>
          <dd className="mt-1 text-sm">{parseFloat(item.inStock)} {item.unitName}</dd>
        </div>
      </dl>

      <Separator />

      <div className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Lots</h2>
        {itemLots.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lots recorded.</p>
        ) : (
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Lot Number</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Quantity</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Cost / Unit</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Received</th>
                </tr>
              </thead>
              <tbody>
                {itemLots.map((lot) => (
                  <tr key={lot.id} className="border-b last:border-0">
                    <td className="px-4 py-2 font-mono">{lot.lotNumber}</td>
                    <td className="px-4 py-2 text-right">{parseFloat(lot.quantity)}</td>
                    <td className="px-4 py-2 text-right">{formatPrice(lot.costPerUnit) ?? "—"}</td>
                    <td className="px-4 py-2 text-right">{lot.receivedAt.toLocaleDateString("en-US")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

Key changes:
- Import and call `getLots(id)` in parallel with `getItem(id)`
- Add a "Lots" section after the detail grid with an HTML table
- Sorted by `receivedAt` ascending (handled by the query's `orderBy`)

- [ ] **Step 2: Build check**

```bash
pnpm build
```

Verify no type errors and the page renders correctly.

- [ ] **Step 3: Commit**

```bash
git add app/\(dashboard\)/inventory/materials/\[id\]/page.tsx
git commit -m "feat: display lots table on material detail page"
```

---

## Chunk 5: Final Verification

### Task 9: End-to-end verification

- [ ] **Step 1: Run full build**

```bash
pnpm build
```

Verify zero type errors across the entire project.

- [ ] **Step 2: Run linter**

```bash
pnpm lint
```

Fix any lint issues.

- [ ] **Step 3: Manual verification checklist**

Start dev server (`pnpm dev`) and verify:

1. Inventory table loads — `inStock` column shows computed values from lots
2. Create a new material with initial stock of 50 and a purchase price — verify it creates successfully
3. View the material detail page — verify:
   - `In Stock` shows 50
   - Lots section shows `LOT-000001` with quantity 50 and the purchase price as cost/unit
4. Create another material with no purchase price — verify lot's cost/unit shows "—"
5. Create a material with initial stock of 0 — verify lot shows with quantity 0
6. Edit a material — verify `initialStock` field is NOT shown (edit mode hides it)

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during verification"
```
