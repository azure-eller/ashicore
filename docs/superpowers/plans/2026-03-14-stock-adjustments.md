# Stock Adjustments Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to adjust material stock levels from the edit form, with full lot-based tracking and an immutable audit trail via a `stock_movements` table.

**Architecture:** "Set the truth" model — user edits the stock value, system computes delta. Positive delta creates a new lot; negative delta FIFO-deducts from oldest lots. Every change logs a `stock_movements` row. A new `updateItemWithStock()` DAL function wraps both metadata update and stock adjustment in a **single transaction**. Item creation also logs an `initial` movement. A movement history section is added to the material detail page.

**Tech Stack:** Drizzle ORM, Neon Postgres, Next.js App Router, Zod, react-hook-form, shadcn/ui (Field components), TanStack Query

**Spec:** `docs/superpowers/specs/2026-03-14-stock-adjustments-design.md`

**Branch:** Create off `feat/lot-tracking` (open PR #16)

**CLAUDE.md rules to follow:**
- Before creating or editing any form or form field, read `docs/references/field-example.md` and `docs/references/react-hook-form-example.md`
- No hardcoded Tailwind colors — use shadcn semantic tokens only
- All DAL query functions use `withAuthedOrgContext(async (tx) => { ... })`
- RLS handles org scoping — do NOT add `eq(table.organizationId, orgId)` WHERE clauses
- API routes wrap handlers with `apiHandler` from `lib/api/handler.ts`
- Icon library: HugeIcons (`@hugeicons/core` / `@hugeicons/react`) — no Lucide
- Never use `drizzle-kit push` — always `generate` then `migrate`
- Mutations use TanStack Query. No optimistic updates.
- Soft delete endpoints set `deletedAt` — never hard-delete master data

---

## File Structure

| File | Responsibility |
|------|---------------|
| `lib/db/schema/stock-movements.ts` | **NEW** — `stock_movements` table definition with RLS, indexes, FK to items and lots |
| `lib/db/schema/index.ts` | **MODIFY** — Re-export `stockMovements` |
| `lib/dal/auth.ts` | **MODIFY** — Extend `withAuthedOrgContext` callback to also provide `userId` |
| `lib/schemas/items.ts` | **MODIFY** — Add `updateItemWithStockSchema` (separate from `updateItemSchema` to avoid type pollution) |
| `app/(dashboard)/inventory/queries.ts` | **MODIFY** — Add `getStockMovements()`, `adjustStockInTx()` (takes `tx`), `updateItemWithStock()` (single-transaction wrapper), extend `createItemWithLot()` to log initial movement |
| `app/api/items/[id]/route.ts` | **MODIFY** — Use `updateItemWithStock` instead of separate calls |
| `app/api/items/route.ts` | **MODIFY** — Pass `userId` to `createItemWithLot` (from extended callback) |
| `app/(dashboard)/inventory/materials/material-form.tsx` | **MODIFY** — Add stock section in edit mode |
| `app/(dashboard)/inventory/materials/[id]/page.tsx` | **MODIFY** — Add stock movement history section |
| `scripts/seed.ts` | **MODIFY** — Insert seed stock movements for seeded lots |

---

## Chunk 1: Schema & Migration

### Task 1: Create stock_movements table schema

**Files:**
- Create: `lib/db/schema/stock-movements.ts`
- Modify: `lib/db/schema/index.ts`

- [ ] **Step 1: Create `lib/db/schema/stock-movements.ts`**

```typescript
import {
  uuid,
  varchar,
  text,
  numeric,
  timestamp,
  pgPolicy,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { inventorySchema } from "./units";
import { items } from "./items";
import { lots } from "./lots";

export const stockMovements = inventorySchema
  .table(
    "stock_movements",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      organizationId: text("organization_id").notNull(),
      itemId: uuid("item_id")
        .notNull()
        .references(() => items.id),
      lotId: uuid("lot_id").references(() => lots.id),
      quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
      reason: varchar("reason", { length: 30 }).notNull(),
      costPerUnit: numeric("cost_per_unit", { precision: 10, scale: 4 }),
      notes: text("notes"),
      createdBy: text("created_by").notNull(),
      createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (table) => [
      index("stock_movements_item_id_idx").on(table.itemId),
      index("stock_movements_created_at_idx").on(table.createdAt),
      pgPolicy("stock_movements_org_isolation", {
        for: "all",
        to: "public",
        using: sql`organization_id = current_setting('app.current_org_id', true)`,
        withCheck: sql`organization_id = current_setting('app.current_org_id', true)`,
      }),
    ]
  )
  .enableRLS();
```

- [ ] **Step 2: Export from schema index**

In `lib/db/schema/index.ts`, add after `export * from "./lots";`:

```typescript
export * from "./stock-movements";
```

- [ ] **Step 3: Generate migration**

Run: `pnpm drizzle-kit generate`

Expected: A new migration file in `drizzle/` creating the `stock_movements` table.

- [ ] **Step 4: Apply migration**

Run: `pnpm drizzle-kit migrate`

Expected: Migration applies successfully.

- [ ] **Step 5: Verify build**

Run: `pnpm build`

Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema/stock-movements.ts lib/db/schema/index.ts drizzle/
git commit -m "feat: add stock_movements table schema with RLS"
```

---

## Chunk 2: Backend — Auth Extension & Stock Adjustment Logic

### Task 2: Extend withAuthedOrgContext to provide userId

**Files:**
- Modify: `lib/dal/auth.ts`

The `withAuthedOrgContext` callback currently provides `(tx, orgId)`. Stock movements need `userId` for `createdBy`. Rather than calling `getAuthedContext()` in DAL query functions (which CLAUDE.md prohibits), extend the callback to `(tx, orgId, userId)`.

- [ ] **Step 1: Update `withAuthedOrgContext` callback signature**

Replace `lib/dal/auth.ts` lines 28-33:

```typescript
export async function withAuthedOrgContext<T>(
  callback: (tx: Tx, orgId: string, userId: string) => Promise<T>
): Promise<T> {
  const { orgId, userId } = await getAuthedContext();
  return withOrgContext(orgId, (tx) => callback(tx, orgId, userId));
}
```

- [ ] **Step 2: Verify build — expect errors**

Run: `pnpm build`

Expected: Type errors in files that use `withAuthedOrgContext` but don't accept the third `userId` parameter in their callback. This is fine — the parameter is optional positionally (unused params are allowed in TypeScript). If any errors appear, add `_userId` to the callback signatures in those functions.

Check which functions use `withAuthedOrgContext` and ensure they still compile. The existing callbacks with `(tx)` or `(tx, orgId)` signatures will still work because TypeScript allows fewer parameters than the callback type defines.

- [ ] **Step 3: Commit**

```bash
git add lib/dal/auth.ts
git commit -m "feat: extend withAuthedOrgContext to provide userId"
```

### Task 3: Add stock adjustment DAL functions

**Files:**
- Modify: `app/(dashboard)/inventory/queries.ts`

This task adds:
1. `getStockMovements(itemId)` — fetch movement history
2. `fifoDeduct()` — private FIFO deduction helper (takes `tx`)
3. `adjustStockInTx()` — stock adjustment logic (takes `tx`, not its own transaction)
4. `updateItemWithStock()` — single-transaction wrapper for metadata + stock adjustment
5. Extend `createItemWithLot()` to log an `initial` movement

- [ ] **Step 1: Add imports**

Update the existing import from `@/lib/db/schema` (line 5):

```typescript
import { items, unitDefinitions, lots, stockMovements } from "@/lib/db/schema";
```

Add `desc` to the drizzle-orm import (line 4):

```typescript
import { and, eq, isNull, isNotNull, sql, desc } from "drizzle-orm";
```

- [ ] **Step 2: Add `getStockMovements` query**

Add after the existing `getLots` function (after line 129):

```typescript
export async function getStockMovements(itemId: string) {
  return withAuthedOrgContext(async (tx) => {
    return tx
      .select({
        id: stockMovements.id,
        quantity: stockMovements.quantity,
        reason: stockMovements.reason,
        costPerUnit: stockMovements.costPerUnit,
        notes: stockMovements.notes,
        createdBy: stockMovements.createdBy,
        createdAt: stockMovements.createdAt,
        lotNumber: lots.lotNumber,
      })
      .from(stockMovements)
      .leftJoin(lots, eq(stockMovements.lotId, lots.id))
      .where(eq(stockMovements.itemId, itemId))
      .orderBy(desc(stockMovements.createdAt));
  });
}
```

- [ ] **Step 3: Add the FIFO deduction helper**

Add after `generateLotNumber` (after line 143):

```typescript
// Deduct stock FIFO across lots for a given item within an existing transaction.
// Throws if insufficient stock — caller should catch and handle.
async function fifoDeduct(
  tx: Tx,
  itemId: string,
  amount: number
): Promise<Array<{ lotId: string; lotNumber: string; quantity: number; costPerUnit: string | null }>> {
  const availableLots = await tx
    .select({
      id: lots.id,
      lotNumber: lots.lotNumber,
      quantity: lots.quantity,
      costPerUnit: lots.costPerUnit,
    })
    .from(lots)
    .where(and(eq(lots.itemId, itemId), sql`${lots.quantity} > 0`))
    .orderBy(lots.receivedAt);

  const totalAvailable = availableLots.reduce(
    (sum, lot) => sum + parseFloat(lot.quantity),
    0
  );

  if (totalAvailable < amount) {
    throw new Error(
      `Insufficient stock. Available: ${totalAvailable}, requested: ${amount}`
    );
  }

  let remaining = amount;
  const allocations: Array<{ lotId: string; lotNumber: string; quantity: number; costPerUnit: string | null }> = [];

  for (const lot of availableLots) {
    if (remaining <= 0) break;
    const lotQty = parseFloat(lot.quantity);
    const deduct = Math.min(lotQty, remaining);

    await tx
      .update(lots)
      .set({
        quantity: (lotQty - deduct).toString(),
        updatedAt: new Date(),
      })
      .where(eq(lots.id, lot.id));

    allocations.push({
      lotId: lot.id,
      lotNumber: lot.lotNumber,
      quantity: deduct,
      costPerUnit: lot.costPerUnit,
    });

    remaining -= deduct;
  }

  return allocations;
}
```

- [ ] **Step 4: Add `adjustStockInTx` (transaction-aware, no own transaction)**

This function takes `tx`, `orgId`, and `userId` as parameters — it does NOT call `withAuthedOrgContext`. It's designed to run inside an existing transaction.

```typescript
// Adjust stock within an existing transaction. Does not create its own transaction.
async function adjustStockInTx(
  tx: Tx,
  orgId: string,
  userId: string,
  itemId: string,
  delta: number,
  reason: string,
  opts?: { costPerUnit?: string | null; notes?: string | null }
): Promise<void> {
  if (delta > 0) {
    const lotNumber = await generateLotNumber(tx);
    const [newLot] = await tx
      .insert(lots)
      .values({
        organizationId: orgId,
        itemId,
        lotNumber,
        quantity: delta.toString(),
        costPerUnit: opts?.costPerUnit ?? null,
      })
      .returning({ id: lots.id });

    await tx.insert(stockMovements).values({
      organizationId: orgId,
      itemId,
      lotId: newLot.id,
      quantity: delta.toString(),
      reason,
      costPerUnit: opts?.costPerUnit ?? null,
      notes: opts?.notes ?? null,
      createdBy: userId,
    });
  } else {
    const allocations = await fifoDeduct(tx, itemId, Math.abs(delta));

    for (const alloc of allocations) {
      await tx.insert(stockMovements).values({
        organizationId: orgId,
        itemId,
        lotId: alloc.lotId,
        quantity: (-alloc.quantity).toString(),
        reason,
        costPerUnit: alloc.costPerUnit,
        notes: opts?.notes ?? null,
        createdBy: userId,
      });
    }
  }
}
```

- [ ] **Step 5: Add `updateItemWithStock` — single-transaction wrapper**

This is the key function that solves the transaction safety issue. Both metadata update and stock adjustment run in one `withAuthedOrgContext` call.

```typescript
// Update item metadata and optionally adjust stock in a single transaction.
// If stock adjustment fails (e.g. insufficient stock), the entire update rolls back.
export async function updateItemWithStock(
  id: string,
  itemData: UpdateItem,
  stockAdjustment?: {
    newStock: number;
    reason: string;
    costPerUnit?: string | null;
    notes?: string | null;
  }
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    // 1. Update item metadata
    const [item] = await tx
      .update(items)
      .set({ ...itemData, updatedAt: new Date() })
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .returning({ id: items.id });

    if (!item) return null;

    // 2. Adjust stock if requested
    if (stockAdjustment) {
      // Compute current stock from lots within this transaction
      const [stockResult] = await tx
        .select({ total: sql<string>`COALESCE(SUM(${lots.quantity}), 0)` })
        .from(lots)
        .where(eq(lots.itemId, id));

      const currentStock = parseFloat(stockResult.total);
      const delta = stockAdjustment.newStock - currentStock;

      if (delta !== 0) {
        await adjustStockInTx(tx, orgId, userId, id, delta, stockAdjustment.reason, {
          costPerUnit: stockAdjustment.costPerUnit,
          notes: stockAdjustment.notes,
        });
      }
    }

    return item;
  });
}
```

Note: This reads current stock **within the same transaction** via `SUM(lots.quantity)`, avoiding the race condition of reading stock from a separate transaction.

- [ ] **Step 6: Extend `createItemWithLot` to log initial movement**

Replace the existing `createItemWithLot` function (lines 145-167). The change: add `.returning({ id: lots.id })` to the lot insert, and log a movement. Uses the new `userId` parameter from `withAuthedOrgContext`.

```typescript
export async function createItemWithLot(
  data: Omit<InsertItem, "initialStock">,
  initialStock: string,
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const [item] = await tx
      .insert(items)
      .values({ ...data, organizationId: orgId })
      .returning({ id: items.id });

    const lotNumber = await generateLotNumber(tx);

    const [lot] = await tx.insert(lots).values({
      organizationId: orgId,
      itemId: item.id,
      lotNumber,
      quantity: initialStock,
      costPerUnit: data.defaultPurchasePrice ?? null,
    }).returning({ id: lots.id });

    // Log initial stock movement
    if (parseFloat(initialStock) > 0) {
      await tx.insert(stockMovements).values({
        organizationId: orgId,
        itemId: item.id,
        lotId: lot.id,
        quantity: initialStock,
        reason: "initial",
        costPerUnit: data.defaultPurchasePrice ?? null,
        createdBy: userId,
      });
    }

    return item;
  });
}
```

Note: `createItemWithLot` no longer needs a `userId` parameter — it gets it from the extended `withAuthedOrgContext` callback.

- [ ] **Step 7: Verify build**

Run: `pnpm build`

Expected: No type errors.

- [ ] **Step 8: Commit**

```bash
git add app/(dashboard)/inventory/queries.ts
git commit -m "feat: add adjustStock with FIFO and stock movement logging"
```

### Task 4: Update API routes and schemas

**Files:**
- Modify: `lib/schemas/items.ts`
- Modify: `app/api/items/[id]/route.ts`
- Modify: `app/api/items/route.ts`

- [ ] **Step 1: Add `updateItemWithStockSchema` (separate from `updateItemSchema`)**

In `lib/schemas/items.ts`, add a **new** schema after the existing `updateItemSchema` (after line 38). Do NOT modify `updateItemSchema` — it stays clean for the `updateItem()` DAL function.

```typescript
// Schema for the API request that combines item metadata + optional stock adjustment.
// Separate from updateItemSchema to avoid polluting the UpdateItem type.
export const updateItemWithStockSchema = updateItemSchema.extend({
  newStock: z.string().refine(
    (v) => !v || parseFloat(v) >= 0,
    "Must be a non-negative number"
  ).optional(),
  stockAdjustmentReason: z.enum(["adjustment", "return", "write_off"]).optional(),
  stockAdjustmentCostPerUnit: z.string().nullable().optional(),
  stockAdjustmentNotes: z.string().nullable().optional(),
});

export type UpdateItemWithStock = z.infer<typeof updateItemWithStockSchema>;
```

- [ ] **Step 2: Rewrite the PUT handler**

Replace `app/api/items/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { updateItemWithStockSchema } from "@/lib/schemas/items";
import { deleteItem, updateItemWithStock } from "@/app/(dashboard)/inventory/queries";

type RouteContext = { params: Promise<{ id: string }> };

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json();
  const {
    newStock,
    stockAdjustmentReason,
    stockAdjustmentCostPerUnit,
    stockAdjustmentNotes,
    ...itemData
  } = updateItemWithStockSchema.parse(body);

  // Build stock adjustment if stock is being changed
  let stockAdjustment: Parameters<typeof updateItemWithStock>[2] | undefined;
  if (newStock != null) {
    if (!stockAdjustmentReason) {
      return NextResponse.json(
        { errors: { stockAdjustmentReason: ["Reason is required when adjusting stock"] } },
        { status: 400 }
      );
    }
    stockAdjustment = {
      newStock: parseFloat(newStock),
      reason: stockAdjustmentReason,
      costPerUnit: stockAdjustmentCostPerUnit,
      notes: stockAdjustmentNotes,
    };
  }

  try {
    const item = await updateItemWithStock(id, itemData, stockAdjustment);
    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    return NextResponse.json(item);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stock adjustment failed";
    return NextResponse.json(
      { errors: { newStock: [message] } },
      { status: 400 }
    );
  }
});

export const DELETE = apiHandler(async (_req: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const deleted = await deleteItem(id);
  if (!deleted) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
});
```

Key differences from old version:
- Uses `updateItemWithStockSchema` (not `updateItemSchema`) — so `UpdateItem` type stays clean
- Calls `updateItemWithStock()` — single transaction for metadata + stock
- No `getAuthedContext()` import — userId is handled inside the DAL
- No separate `getItem()` call to read current stock — `updateItemWithStock` reads it in-transaction

- [ ] **Step 3: Simplify the POST route**

`createItemWithLot` no longer needs a `userId` parameter — it gets it from `withAuthedOrgContext`. Revert the POST route to its original simplicity (no `getAuthedContext` import needed):

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

This is identical to the existing file — no changes needed. The movement logging happens inside `createItemWithLot` transparently.

- [ ] **Step 4: Verify build**

Run: `pnpm build`

Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/schemas/items.ts app/api/items/\[id\]/route.ts
git commit -m "feat: extend update API with stock adjustment support"
```

---

## Chunk 3: Frontend — Edit Form Stock Section

### Task 5: Add stock adjustment fields to material edit form

**Files:**
- Modify: `app/(dashboard)/inventory/materials/material-form.tsx`

**IMPORTANT:** Before editing this file, read `docs/references/field-example.md` and `docs/references/react-hook-form-example.md` to follow existing form patterns exactly.

- [ ] **Step 1: Update form type and defaultValues**

The form currently uses `useForm<InsertItem | UpdateItem>`. Since we're adding stock fields that only exist on `UpdateItemWithStock`, import the new type and use it for the edit case.

Add to imports (line 8):

```typescript
import {
  insertItemSchema,
  updateItemWithStockSchema,
  type InsertItem,
  type UpdateItemWithStock,
} from "@/lib/schemas/items";
```

Update the `useForm` call (line 108):

```typescript
const form = useForm<InsertItem | UpdateItemWithStock>({
  resolver: zodResolver(initialData ? updateItemWithStockSchema : insertItemSchema),
  mode: "onBlur",
  defaultValues: initialData
    ? {
        name: initialData.name,
        sku: initialData.sku,
        category: initialData.category,
        description: initialData.description,
        defaultPurchasePrice: initialData.defaultPurchasePrice != null
          ? String(parseFloat(initialData.defaultPurchasePrice))
          : null,
        newStock: String(parseFloat(initialData.inStock)),
        stockAdjustmentCostPerUnit: initialData.defaultPurchasePrice,
      }
    : {
        name: "",
        itemType: "material" as const,
        unitDefinitionId: "",
        initialStock: "0",
      },
});
```

Also remove the `updateItemSchema` import since it's no longer used in this file (only `updateItemWithStockSchema` is used for validation). Keep `UpdateItem` only if needed elsewhere — check if `UpdateItem` is used. Looking at the code, `UpdateItem` was only in the union type for `useForm`, so it can be replaced.

- [ ] **Step 2: Add stock change detection variables**

After the `form` declaration (around line 127):

```typescript
const watchedNewStock = form.watch("newStock");
const currentStock = initialData ? parseFloat(initialData.inStock) : 0;
const newStockValue = watchedNewStock != null && watchedNewStock !== ""
  ? parseFloat(watchedNewStock)
  : NaN;
const stockChanged = initialData && !isNaN(newStockValue) && newStockValue !== currentStock;
const stockIncreasing = initialData && !isNaN(newStockValue) && newStockValue > currentStock;
```

- [ ] **Step 3: Add the stock section to the form**

Inside the form JSX, after the existing `</FieldSet>` closing tag for "Pricing & Stock" (line 428), add before the outer `</FieldGroup>` (line 429):

```tsx
{initialData && (
  <>
    <FieldSeparator />
    <FieldSet>
      <FieldLegend>Stock</FieldLegend>
      <FieldDescription>
        Change the stock level. The system will create or adjust lots automatically.
      </FieldDescription>
      <FieldGroup>
        <Field>
          <FieldLabel>Current Stock</FieldLabel>
          <p className="text-sm py-2">
            {parseFloat(initialData.inStock)} {initialData.unitName}
          </p>
        </Field>

        <Controller
          name="newStock"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>New Stock</FieldLabel>
              <Input
                {...field}
                id={field.name}
                value={field.value ?? ""}
                aria-invalid={fieldState.invalid}
                placeholder={String(parseFloat(initialData.inStock))}
                inputMode="decimal"
                autoComplete="off"
              />
              {fieldState.invalid && (
                <FieldError errors={[fieldState.error]} />
              )}
            </Field>
          )}
        />

        {stockChanged && (
          <>
            <Controller
              name="stockAdjustmentReason"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Reason</FieldLabel>
                  <Select
                    name={field.name}
                    value={field.value ?? ""}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger
                      id={field.name}
                      aria-invalid={fieldState.invalid}
                      className="w-full"
                    >
                      <SelectValue placeholder="Select a reason" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="adjustment">Adjustment</SelectItem>
                      <SelectItem value="return">Return</SelectItem>
                      <SelectItem value="write_off">Write-off</SelectItem>
                    </SelectContent>
                  </Select>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            {stockIncreasing && (
              <Controller
                name="stockAdjustmentCostPerUnit"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>Cost / Unit</FieldLabel>
                    <Input
                      {...field}
                      id={field.name}
                      value={field.value ?? ""}
                      aria-invalid={fieldState.invalid}
                      placeholder="Defaults to purchase price"
                      inputMode="decimal"
                      autoComplete="off"
                    />
                    <FieldDescription>
                      Leave blank to use the default purchase price.
                    </FieldDescription>
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />
            )}

            <Controller
              name="stockAdjustmentNotes"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Notes</FieldLabel>
                  <Textarea
                    {...field}
                    id={field.name}
                    value={field.value ?? ""}
                    aria-invalid={fieldState.invalid}
                    placeholder="Optional notes about this adjustment"
                    rows={2}
                    autoComplete="off"
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          </>
        )}
      </FieldGroup>
    </FieldSet>
  </>
)}
```

- [ ] **Step 4: Verify build**

Run: `pnpm build`

Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add app/(dashboard)/inventory/materials/material-form.tsx
git commit -m "feat: add stock adjustment fields to material edit form"
```

---

## Chunk 4: Frontend — Movement History & Seed Data

### Task 6: Add stock movement history to material detail page

**Files:**
- Modify: `app/(dashboard)/inventory/materials/[id]/page.tsx`

- [ ] **Step 1: Import `getStockMovements` and add to data fetch**

Update imports:

```typescript
import { getItem, getLots, getStockMovements } from "@/app/(dashboard)/inventory/queries";
```

Update the `Promise.all` (line 14):

```typescript
const [item, itemLots, movements] = await Promise.all([
  getItem(id),
  getLots(id),
  getStockMovements(id),
]);
```

- [ ] **Step 2: Add the movement history section**

After the closing `</div>` of the lots section (around line 102), add:

```tsx
<Separator />

<div className="space-y-3">
  <h2 className="text-lg font-semibold tracking-tight">Stock Movements</h2>
  {movements.length === 0 ? (
    <p className="text-sm text-muted-foreground">No stock movements recorded.</p>
  ) : (
    <div className="rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Date</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Reason</th>
            <th className="px-4 py-2 text-right font-medium text-muted-foreground">Quantity</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Lot</th>
            <th className="px-4 py-2 text-right font-medium text-muted-foreground">Cost / Unit</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Notes</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((m) => {
            const qty = parseFloat(m.quantity);
            return (
              <tr key={m.id} className="border-b last:border-0">
                <td className="px-4 py-2">
                  {m.createdAt.toLocaleDateString("en-US")}
                </td>
                <td className="px-4 py-2 capitalize">{m.reason.replace("_", " ")}</td>
                <td className={`px-4 py-2 text-right font-mono ${qty > 0 ? "text-foreground" : "text-destructive"}`}>
                  {qty > 0 ? "+" : ""}{qty}
                </td>
                <td className="px-4 py-2 font-mono">{m.lotNumber ?? "—"}</td>
                <td className="px-4 py-2 text-right">{formatPrice(m.costPerUnit) ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground max-w-[200px] truncate">
                  {m.notes ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  )}
</div>
```

Note: Uses `text-foreground` for positive quantities and `text-destructive` for negative — both are shadcn semantic tokens. The `+` prefix on positive quantities provides clear visual differentiation without requiring a custom green color.

- [ ] **Step 3: Verify build**

Run: `pnpm build`

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add app/(dashboard)/inventory/materials/\[id\]/page.tsx
git commit -m "feat: add stock movement history to material detail page"
```

### Task 7: Update seed script to create stock movements

**Files:**
- Modify: `scripts/seed.ts`

- [ ] **Step 1: Import `stockMovements` and `withOrgContext`**

Update the dynamic import (line 6):

```typescript
const { organization, unitDefinitions, items, lots, stockMovements } = await import("@/lib/db/schema");
```

Also add a static import for `withOrgContext` at the top of the file (after the `config` import):

```typescript
import { withOrgContext } from "@/lib/db/with-org-context";
```

- [ ] **Step 2: Create seed stock movements**

After the lot creation loop (after line 149, before "Seed complete"), add:

```typescript
  // 5. Create initial stock movements for seeded lots
  // Use withOrgContext to set RLS context for the SELECT query on lots
  const seededLots = await withOrgContext(orgId, async (tx) => {
    return tx
      .select({ id: lots.id, itemId: lots.itemId, quantity: lots.quantity, costPerUnit: lots.costPerUnit })
      .from(lots);
  });

  for (const lot of seededLots) {
    if (parseFloat(lot.quantity) > 0) {
      await withOrgContext(orgId, async (tx) => {
        await tx.insert(stockMovements).values({
          organizationId: orgId,
          itemId: lot.itemId,
          lotId: lot.id,
          quantity: lot.quantity,
          reason: "initial",
          costPerUnit: lot.costPerUnit,
          createdBy: "seed",
        });
      });
    }
  }
  console.log(`Created ${seededLots.filter(l => parseFloat(l.quantity) > 0).length} initial stock movements`);
```

Note: Uses `withOrgContext` (not `withAuthedOrgContext`) because the seed script has no session. This sets `app.current_org_id` for RLS to work on the `lots` SELECT and `stockMovements` INSERT.

- [ ] **Step 3: Verify build**

Run: `pnpm build`

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed.ts
git commit -m "feat: seed stock movements for initial lot data"
```

---

## Chunk 5: Verify & Push

### Task 8: End-to-end verification

- [ ] **Step 1: Full build check**

Run: `pnpm build`

Expected: Zero type errors.

- [ ] **Step 2: Start dev server and manually test**

Run: `pnpm dev`

Test the following:
1. Navigate to a material detail page — verify lots table and empty movements section display
2. Click "Edit" — verify the stock section appears with Current Stock and New Stock fields
3. Change New Stock to a higher value — verify Reason dropdown and Cost/Unit field appear
4. Change New Stock to a lower value — verify Reason dropdown appears but Cost/Unit is hidden
5. Set New Stock back to original value — verify Reason/Notes fields disappear
6. Submit with a higher stock value + reason — verify redirect to detail page, new lot visible, movement logged
7. Submit with a lower stock value + reason — verify FIFO deduction in lots, movement(s) logged
8. Try to decrease more than available — verify error message appears on the New Stock field
9. Create a new material with initial stock > 0 — verify `initial` movement appears on detail page

- [ ] **Step 3: Push branch**

```bash
git push -u origin feat/stock-adjustments
```

- [ ] **Step 4: Create PR**

```bash
gh pr create --base feat/lot-tracking --title "feat: stock adjustments with lot tracking and audit trail" --body "$(cat <<'EOF'
## Summary
- **Stock adjustments via edit form:** Change the stock value on the material edit page — system creates new lots (increase) or FIFO-deducts from existing lots (decrease)
- **`stock_movements` audit table:** Every stock change (including initial stock on item creation) creates an immutable movement record with quantity, reason, cost, user, and lot reference
- **Movement history:** Material detail page shows chronological movement history with signed quantities
- **Single transaction:** Metadata update + stock adjustment run atomically — if stock adjustment fails, metadata changes roll back too

## Design spec
`docs/superpowers/specs/2026-03-14-stock-adjustments-design.md`

## Test plan
- [ ] Edit material, increase stock → new lot created, movement logged
- [ ] Edit material, decrease stock → FIFO deduction from oldest lots, movement(s) logged
- [ ] Decrease more than available → error "Insufficient stock" shown on form
- [ ] Change stock back to current value → reason/notes fields disappear, no adjustment on save
- [ ] Create new material with initial stock → `initial` movement logged
- [ ] Material detail page shows movement history sorted newest-first
- [ ] Metadata + stock update is atomic (stock failure rolls back name changes too)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
