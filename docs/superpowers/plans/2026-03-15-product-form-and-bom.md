# Product Form & BOM Editor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify material/product forms, add selling price to both, add BOM editor for products, clean up BOM schema.

**Architecture:** Single `ItemForm` component replaces `MaterialForm`, conditionally renders a `BomEditor` sub-component for products. BOM is saved atomically with the item via the existing `/api/items` endpoints. No new API routes.

**Tech Stack:** Next.js App Router, Drizzle ORM, Zod (drizzle-zod), react-hook-form (useFieldArray), TanStack Query, shadcn/ui Table + Combobox

**Spec:** `docs/superpowers/specs/2026-03-15-product-form-and-bom-design.md`

---

## Chunk 1: Schema & Data Layer

### Task 1: Update BOM schema and generate migration

**Files:**
- Modify: `lib/db/schema/bom.ts`
- Modify: `lib/db/schema/items.ts`

- [ ] **Step 1: Update `lib/db/schema/bom.ts`**

Replace the entire file. Rename `parentItemId` → `itemId`, drop `uom`, `sortOrder` columns, update RLS policy and constraints:

```typescript
import {
  uuid,
  numeric,
  timestamp,
  unique,
  check,
  pgPolicy,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { inventorySchema } from "./units";
import { items } from "./items";

export const bomComponents = inventorySchema
  .table(
    "bom_components",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      itemId: uuid("item_id")
        .notNull()
        .references(() => items.id, { onDelete: "cascade" }),
      componentId: uuid("component_id")
        .notNull()
        .references(() => items.id, { onDelete: "restrict" }),
      quantity: numeric("quantity", { precision: 12, scale: 4 }),
      percentage: numeric("percentage", { precision: 5, scale: 2 }),
      createdAt: timestamp("created_at").notNull().defaultNow(),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
      unique("unique_bom_component").on(table.itemId, table.componentId),
      check("no_self_reference", sql`item_id != component_id`),
      pgPolicy("bom_components_org_isolation", {
        for: "all",
        to: "public",
        using: sql`item_id IN (SELECT id FROM inventory.items WHERE organization_id = current_setting('app.current_org_id', true))`,
        withCheck: sql`item_id IN (SELECT id FROM inventory.items WHERE organization_id = current_setting('app.current_org_id', true))`,
      }),
    ]
  )
  .enableRLS();
```

- [ ] **Step 2: Add `bomMode` column to `lib/db/schema/items.ts`**

Add after the `defaultSellingPrice` field:

```typescript
// BOM mode — "quantity" or "percentage", null for non-products
bomMode: varchar("bom_mode", { length: 20 }),
```

Add the `varchar` import if not already present.

- [ ] **Step 3: Generate and apply migration**

Run:
```bash
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
```

Verify the generated SQL renames `parent_item_id` to `item_id`, drops `uom` and `sort_order`, adds `bom_mode` to `items`, and updates the RLS policy and constraints.

- [ ] **Step 4: Commit**

```bash
git add lib/db/schema/bom.ts lib/db/schema/items.ts drizzle/
git commit -m "feat: clean up bom_components schema and add bomMode to items"
```

### Task 2: Update Zod schemas

**Files:**
- Modify: `lib/schemas/items.ts`
- Create: `lib/schemas/bom.ts`

- [ ] **Step 1: Update `lib/schemas/items.ts`**

1. Remove `defaultSellingPrice` from the `.omit({})` block
2. Add `defaultSellingPrice: nullableString` to the `createInsertSchema` overrides
3. Add `bomMode` and `bom` fields via `.extend()`
4. Add `.superRefine()` for BOM mode validation

```typescript
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { items } from "@/lib/db/schema";

const nullableString = z
  .string()
  .nullable()
  .transform((v) => (v != null ? v.trim() || null : null));

const bomRowSchema = z.object({
  componentId: z.string().min(1, "Component is required"),
  quantity: nullableString,
  percentage: nullableString,
});

export const insertItemSchema = createInsertSchema(items, {
  name: z.string().min(1, "Name is required"),
  itemType: z.enum(["product", "material"]),
  unitDefinitionId: z.string().min(1, "Unit is required"),
  sku: nullableString,
  category: nullableString,
  defaultPurchasePrice: nullableString,
  defaultSellingPrice: nullableString,
  description: nullableString,
  safetyStock: z.string().transform((v) => (v.trim() === "" ? "0" : v)),
  bomMode: z.enum(["quantity", "percentage"]).nullable().optional(),
}).omit({
  id: true,
  organizationId: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  committedQty: true,
  expectedQty: true,
}).extend({
  stock: z.string().default("0").refine(
    (v) => { const n = Number(v); return !isNaN(n) && n >= 0; },
    "Must be a non-negative number"
  ),
  bom: z.array(bomRowSchema).optional(),
}).superRefine((data, ctx) => {
  if (!data.bom || data.bom.length === 0) return;
  for (let i = 0; i < data.bom.length; i++) {
    const row = data.bom[i];
    if (data.bomMode === "quantity" && !row.quantity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Quantity is required",
        path: ["bom", i, "quantity"],
      });
    }
    if (data.bomMode === "percentage" && !row.percentage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Percentage is required",
        path: ["bom", i, "percentage"],
      });
    }
  }
});

export type InsertItem = z.infer<typeof insertItemSchema>;

// Update schema: itemType, unitDefinitionId are immutable after creation.
// stock is optional — if provided, triggers a stock adjustment.
export const updateItemSchema = insertItemSchema.omit({
  itemType: true,
  unitDefinitionId: true,
  stock: true,
}).extend({
  stock: z.string().refine(
    (v) => { const n = Number(v); return !isNaN(n) && n >= 0; },
    "Must be a non-negative number"
  ).optional(),
  bom: z.array(bomRowSchema).optional(),
  bomMode: z.enum(["quantity", "percentage"]).nullable().optional(),
});

export type UpdateItem = z.infer<typeof updateItemSchema>;
```

- [ ] **Step 2: Create `lib/schemas/bom.ts`**

```typescript
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { bomComponents } from "@/lib/db/schema";

export const insertBomComponentSchema = createInsertSchema(bomComponents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertBomComponent = z.infer<typeof insertBomComponentSchema>;
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm build`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add lib/schemas/items.ts lib/schemas/bom.ts
git commit -m "feat: update Zod schemas with sellingPrice, bomMode, and bom array"
```

### Task 3: Add BOM queries and update existing queries

**Files:**
- Modify: `app/(dashboard)/inventory/queries.ts`

- [ ] **Step 1: Add BOM import and new query functions**

Add `bomComponents` to the import from `@/lib/db/schema`. Then add these functions at the end of the file:

```typescript
export async function getBomComponents(itemId: string) {
  return withAuthedOrgContext(async (tx) => {
    const rows = await tx
      .select({
        id: bomComponents.id,
        componentId: bomComponents.componentId,
        quantity: bomComponents.quantity,
        percentage: bomComponents.percentage,
        componentName: items.name,
        componentItemType: items.itemType,
        componentUnit: unitDefinitions.name,
      })
      .from(bomComponents)
      .innerJoin(items, eq(bomComponents.componentId, items.id))
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(eq(bomComponents.itemId, itemId));
    return rows;
  });
}

export async function getAvailableComponents(excludeItemId?: string) {
  return withAuthedOrgContext(async (tx) => {
    const conditions = [isNull(items.deletedAt)];
    if (excludeItemId) {
      conditions.push(sql`${items.id} != ${excludeItemId}`);
    }
    const rows = await tx
      .select({
        id: items.id,
        name: items.name,
        itemType: items.itemType,
        unit: unitDefinitions.name,
      })
      .from(items)
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(...conditions));
    return rows;
  });
}
```

- [ ] **Step 2: Update `getItem` to include new columns**

Add `defaultSellingPrice` and `bomMode` to the select in `getItem`:

```typescript
defaultSellingPrice: items.defaultSellingPrice,
bomMode: items.bomMode,
```

Add these after the `defaultPurchasePrice` line in the select object.

- [ ] **Step 3: Update `createItemWithLot` to handle BOM**

Modify to accept and insert BOM components in the same transaction. Change signature and add BOM insert after item creation:

```typescript
export async function createItemWithLot(
  data: Omit<InsertItem, "stock" | "bom">,
  stock: string,
  bom?: Array<{ componentId: string; quantity: string | null; percentage: string | null }>,
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const [item] = await tx
      .insert(items)
      .values({ ...data, organizationId: orgId })
      .returning({ id: items.id });

    if (parseFloat(stock) > 0) {
      const lotNumber = await generateLotNumber(tx);
      const [lot] = await tx.insert(lots).values({
        organizationId: orgId,
        itemId: item.id,
        lotNumber,
        quantity: stock,
        costPerUnit: data.defaultPurchasePrice ?? null,
      }).returning({ id: lots.id });

      await tx.insert(stockMovements).values({
        organizationId: orgId,
        itemId: item.id,
        lotId: lot.id,
        quantity: stock,
        createdBy: userId,
      });
    }

    if (bom && bom.length > 0) {
      await tx.insert(bomComponents).values(
        bom.map((row) => ({
          itemId: item.id,
          componentId: row.componentId,
          quantity: row.quantity,
          percentage: row.percentage,
        }))
      );
    }

    return item;
  });
}
```

- [ ] **Step 4: Update `updateItem` to handle BOM**

Add BOM parameter and logic. After the item update, delete existing BOM rows and insert new ones:

```typescript
export async function updateItem(
  id: string,
  itemData: Omit<UpdateItem, "stock" | "bom">,
  stock?: number,
  bom?: Array<{ componentId: string; quantity: string | null; percentage: string | null }>,
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const [item] = await tx
      .update(items)
      .set({ ...itemData, updatedAt: new Date() })
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .returning({ id: items.id });

    if (!item) return null;

    if (stock != null) {
      const [stockResult] = await tx
        .select({ total: sql<string>`COALESCE(SUM(${lots.quantity}), 0)` })
        .from(lots)
        .where(eq(lots.itemId, id));

      const currentStock = parseFloat(stockResult.total);
      const delta = stock - currentStock;

      if (delta !== 0) {
        await adjustStockInTx(tx, orgId, userId, id, delta);
      }
    }

    if (bom !== undefined) {
      await tx.delete(bomComponents).where(eq(bomComponents.itemId, id));
      if (bom.length > 0) {
        await tx.insert(bomComponents).values(
          bom.map((row) => ({
            itemId: id,
            componentId: row.componentId,
            quantity: row.quantity,
            percentage: row.percentage,
          }))
        );
      }
    }

    return item;
  });
}
```

- [ ] **Step 5: Verify types compile**

Run: `pnpm build`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add app/(dashboard)/inventory/queries.ts
git commit -m "feat: add BOM queries, update createItemWithLot and updateItem for BOM"
```

### Task 4: Update API routes

**Files:**
- Modify: `app/api/items/route.ts`
- Modify: `app/api/items/[id]/route.ts`
- Modify: `app/(dashboard)/inventory/queries.ts` (add `isItemUsedInBom`)

- [ ] **Step 1: Update POST route to pass BOM**

In `app/api/items/route.ts`, update the POST handler to extract and pass `bom`:

```typescript
export const POST = apiHandler(async (request) => {
  const body = await request.json();
  const { stock, bom, ...data } = insertItemSchema.parse(body);
  const item = await createItemWithLot(data, stock, bom);
  return NextResponse.json(item, { status: 201 });
});
```

- [ ] **Step 2: Update PUT route to pass BOM**

In `app/api/items/[id]/route.ts`, update the PUT handler:

```typescript
export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json();
  const { stock, bom, ...itemData } = updateItemSchema.parse(body);

  try {
    const item = await updateItem(
      id,
      itemData,
      stock != null ? parseFloat(stock) : undefined,
      bom,
    );
    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    return NextResponse.json(item);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Insufficient stock")) {
      return NextResponse.json(
        { errors: { stock: [error.message] } },
        { status: 400 }
      );
    }
    throw error;
  }
});
```

- [ ] **Step 3: Add BOM reference check and update DELETE route**

Since `deleteItem` uses soft delete (UPDATE, not DELETE), the FK `onDelete: "restrict"` constraint never fires. Add an application-level pre-check instead.

Add to `queries.ts`:

```typescript
export async function isItemUsedInBom(itemId: string): Promise<boolean> {
  return withAuthedOrgContext(async (tx) => {
    const [row] = await tx
      .select({ id: bomComponents.id })
      .from(bomComponents)
      .where(eq(bomComponents.componentId, itemId))
      .limit(1);
    return row != null;
  });
}
```

Update the DELETE handler in `app/api/items/[id]/route.ts`:

```typescript
import { deleteItem, isItemUsedInBom } from "@/app/(dashboard)/inventory/queries";

export const DELETE = apiHandler(async (_req: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;

  const usedInBom = await isItemUsedInBom(id);
  if (usedInBom) {
    return NextResponse.json(
      { error: "Cannot delete: this item is used as a component in other products." },
      { status: 400 }
    );
  }

  const deleted = await deleteItem(id);
  if (!deleted) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
});
```

- [ ] **Step 4: Verify types compile**

Run: `pnpm build`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add app/api/items/route.ts app/api/items/[id]/route.ts app/(dashboard)/inventory/queries.ts
git commit -m "feat: extend item API routes with BOM support and delete protection"
```

---

## Chunk 2: Unified Item Form & BOM Editor UI

### Task 5: Create BOM Editor component

**Files:**
- Create: `app/(dashboard)/inventory/bom-editor.tsx`

- [ ] **Step 1: Create `bom-editor.tsx`**

Each table row is extracted into a `BomRow` sub-component to avoid calling `useWatch` inside a `.map()` loop (Rules of Hooks). The Combobox follows the same API as the category combobox in the existing material form.

```tsx
"use client";

import { useState, useMemo } from "react";
import { useFieldArray, useWatch, Controller, type Control } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Field,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { InsertItem } from "@/lib/schemas/items";

type AvailableComponent = {
  id: string;
  name: string;
  itemType: string;
  unit: string;
};

interface BomEditorProps {
  control: Control<InsertItem>;
  availableComponents: AvailableComponent[];
}

export function BomEditor({ control, availableComponents }: BomEditorProps) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "bom",
  });

  const bomMode = useWatch({ control, name: "bomMode" }) ?? "quantity";

  const componentMap = useMemo(
    () => new Map(availableComponents.map((c) => [c.id, c])),
    [availableComponents]
  );

  return (
    <FieldSet>
      <FieldLegend>Recipe / Bill of Materials</FieldLegend>
      <FieldDescription>
        Ingredients needed to produce one unit of this product.
      </FieldDescription>
      <FieldGroup>
        <Controller
          name="bomMode"
          control={control}
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Mode</FieldLabel>
              <Select
                name={field.name}
                value={field.value ?? "quantity"}
                onValueChange={field.onChange}
              >
                <SelectTrigger id={field.name} className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quantity">Quantity per unit</SelectItem>
                  <SelectItem value="percentage">Percentage</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}
        />

        {fields.length > 0 && (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Component</TableHead>
                  <TableHead className="w-32">
                    {bomMode === "percentage" ? "%" : "Qty"}
                  </TableHead>
                  <TableHead className="w-24">Unit</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((field, index) => (
                  <BomRow
                    key={field.id}
                    index={index}
                    control={control}
                    bomMode={bomMode}
                    availableComponents={availableComponents}
                    componentMap={componentMap}
                    onRemove={() => remove(index)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {bomMode === "percentage" && fields.length > 0 && (
          <PercentageTotal control={control} />
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            append({ componentId: "", quantity: null, percentage: null })
          }
        >
          + Add Ingredient
        </Button>
      </FieldGroup>
    </FieldSet>
  );
}

/** Extracted sub-component so useWatch can be called at the top level (Rules of Hooks). */
function BomRow({
  index,
  control,
  bomMode,
  availableComponents,
  componentMap,
  onRemove,
}: {
  index: number;
  control: Control<InsertItem>;
  bomMode: string;
  availableComponents: AvailableComponent[];
  componentMap: Map<string, AvailableComponent>;
  onRemove: () => void;
}) {
  const componentId = useWatch({ control, name: `bom.${index}.componentId` });
  const selectedComponent = componentMap.get(componentId ?? "");
  const [comboboxInput, setComboboxInput] = useState("");

  const componentNames = useMemo(
    () => availableComponents.map((c) => c.name),
    [availableComponents]
  );

  // Build a name→id map for the combobox (which uses string values)
  const nameToId = useMemo(
    () => new Map(availableComponents.map((c) => [c.name, c.id])),
    [availableComponents]
  );

  return (
    <TableRow>
      <TableCell>
        <Controller
          name={`bom.${index}.componentId`}
          control={control}
          render={({ field: f }) => (
            <Combobox
              items={componentNames}
              value={selectedComponent?.name ?? ""}
              onValueChange={(name) => {
                const id = nameToId.get(name) ?? "";
                f.onChange(id);
              }}
              onInputValueChange={setComboboxInput}
            >
              <ComboboxInput placeholder="Search items..." />
              <ComboboxContent>
                <ComboboxEmpty>No items found</ComboboxEmpty>
                <ComboboxList>
                  {(name: string) => {
                    const comp = availableComponents.find((c) => c.name === name);
                    return (
                      <ComboboxItem key={name} value={name}>
                        <span>{name}</span>
                        {comp && (
                          <Badge variant="outline" className="ml-auto text-xs">
                            {comp.itemType}
                          </Badge>
                        )}
                      </ComboboxItem>
                    );
                  }}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          )}
        />
      </TableCell>
      <TableCell>
        <Controller
          name={
            bomMode === "percentage"
              ? `bom.${index}.percentage`
              : `bom.${index}.quantity`
          }
          control={control}
          render={({ field: f, fieldState }) => (
            <Input
              {...f}
              value={f.value ?? ""}
              aria-invalid={fieldState.invalid}
              placeholder="0"
              inputMode="decimal"
              autoComplete="off"
              className="w-full"
            />
          )}
        />
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {selectedComponent?.unit ?? "—"}
      </TableCell>
      <TableCell>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="h-8 w-8 p-0 text-muted-foreground"
        >
          &times;
        </Button>
      </TableCell>
    </TableRow>
  );
}

function PercentageTotal({ control }: { control: Control<InsertItem> }) {
  const bom = useWatch({ control, name: "bom" });
  const total = (bom ?? []).reduce((sum, row) => {
    const val = parseFloat(row?.percentage ?? "0");
    return sum + (isNaN(val) ? 0 : val);
  }, 0);

  return (
    <p className={`text-sm ${Math.abs(total - 100) < 0.01 ? "text-muted-foreground" : "text-destructive"}`}>
      Total: {total.toFixed(1)}%
      {Math.abs(total - 100) >= 0.01 && " (should be 100%)"}
    </p>
  );
}
```

**Note:** The Combobox API above follows the same pattern as the category combobox in the existing material form (string items, `value`/`onValueChange`/`onInputValueChange` props). If the Base UI Combobox wrapper requires adjustment for object items, adapt accordingly — read `components/ui/combobox.tsx` before implementing.

- [ ] **Step 2: Verify types compile**

Run: `pnpm build`

- [ ] **Step 3: Commit**

```bash
git add app/(dashboard)/inventory/bom-editor.tsx
git commit -m "feat: create BomEditor component with table layout and mode toggle"
```

### Task 6: Create unified ItemForm component

**Files:**
- Create: `app/(dashboard)/inventory/item-form.tsx`
- Delete: `app/(dashboard)/inventory/materials/material-form.tsx`

- [ ] **Step 1: Create `item-form.tsx`**

Copy the content of `material-form.tsx` to `app/(dashboard)/inventory/item-form.tsx`. Then apply these changes:

1. Rename `MaterialForm` → `ItemForm`, `MaterialFormProps` → `ItemFormProps`
2. Add `itemType` prop: `itemType: "material" | "product"`
3. Add `availableComponents` prop (optional, for products)
4. Add `bomMode` and `bom` to `initialData` type
5. Add `defaultSellingPrice` to `initialData` type and form `defaultValues`
6. Replace hardcoded `"material"` strings with `itemType` prop
7. Replace hardcoded `/inventory/materials` paths with `/inventory/${ITEM_TYPE_SEGMENTS[itemType]}`
8. Update labels: `"Add Material"` → `itemType === "product" ? "Add Product" : "Add Material"`, etc.
9. Update query key invalidation: `["items", "material"]` → `["items", itemType]`
10. Add selling price field next to purchase price in the Pricing & Stock section
11. Add `bomMode` to form defaultValues (`initialData?.bomMode ?? "quantity"`)
12. Add `bom` to form defaultValues (`initialData?.bom ?? []`)
13. Import and render `<BomEditor />` after the Pricing & Stock fieldset, wrapped in `{itemType === "product" && ( ... )}`

The selling price field follows the exact same pattern as the purchase price field:

```tsx
<Controller
  name="defaultSellingPrice"
  control={form.control}
  render={({ field, fieldState }) => (
    <Field data-invalid={fieldState.invalid}>
      <FieldLabel htmlFor={field.name}>Selling Price</FieldLabel>
      <Input
        {...field}
        id={field.name}
        value={field.value ?? ""}
        aria-invalid={fieldState.invalid}
        placeholder="0.00"
        inputMode="decimal"
        autoComplete="off"
      />
      {fieldState.invalid && (
        <FieldError errors={[fieldState.error]} />
      )}
    </Field>
  )}
/>
```

The BOM section is gated:

```tsx
{itemType === "product" && availableComponents && (
  <>
    <FieldSeparator />
    <BomEditor
      control={form.control}
      availableComponents={availableComponents}
    />
  </>
)}
```

- [ ] **Step 2: Delete `material-form.tsx`**

```bash
rm app/(dashboard)/inventory/materials/material-form.tsx
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm build`
Expected: Build errors in material pages that still import `MaterialForm` — fixed in Task 7.

- [ ] **Step 4: Commit**

```bash
git add app/(dashboard)/inventory/item-form.tsx
git rm app/(dashboard)/inventory/materials/material-form.tsx
git commit -m "feat: create unified ItemForm, delete MaterialForm"
```

### Task 7: Update material pages to use ItemForm

**Files:**
- Modify: `app/(dashboard)/inventory/materials/new/page.tsx`
- Modify: `app/(dashboard)/inventory/materials/[id]/edit/page.tsx`
- Modify: `app/(dashboard)/inventory/materials/[id]/page.tsx`

- [ ] **Step 1: Update `materials/new/page.tsx`**

```tsx
import { getCategories, getUnitDefinitions } from "@/app/(dashboard)/inventory/queries";
import { ItemForm } from "@/app/(dashboard)/inventory/item-form";

export default async function NewMaterialPage() {
  const [units, categories] = await Promise.all([
    getUnitDefinitions(),
    getCategories(),
  ]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-3xl">
        <ItemForm itemType="material" units={units} categories={categories} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `materials/[id]/edit/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import {
  getItem,
  getUnitDefinitions,
  getCategories,
} from "@/app/(dashboard)/inventory/queries";
import { ItemForm } from "@/app/(dashboard)/inventory/item-form";

export default async function EditMaterialPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [item, units, categories] = await Promise.all([
    getItem(id),
    getUnitDefinitions(),
    getCategories(),
  ]);
  if (!item) redirect("/inventory/materials");

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-3xl">
        <ItemForm
          itemType="material"
          units={units}
          categories={categories}
          initialData={item}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update `materials/[id]/page.tsx` — add selling price display**

Add a selling price `<div>` block after the purchase price block (after line 69):

```tsx
<div>
  <dt className="text-sm font-medium text-muted-foreground">
    Selling Price
  </dt>
  <dd className="mt-1 text-sm">
    {formatPrice(item.defaultSellingPrice) ?? "—"}
  </dd>
</div>
```

- [ ] **Step 4: Verify build passes**

Run: `pnpm build`
Expected: PASS — all material pages now use `ItemForm`

- [ ] **Step 5: Commit**

```bash
git add app/(dashboard)/inventory/materials/
git commit -m "feat: update material pages to use unified ItemForm"
```

### Task 8: Create product pages

**Files:**
- Create: `app/(dashboard)/inventory/products/new/page.tsx`
- Create: `app/(dashboard)/inventory/products/[id]/page.tsx`
- Create: `app/(dashboard)/inventory/products/[id]/edit/page.tsx`

- [ ] **Step 1: Create `products/new/page.tsx`**

```tsx
import {
  getCategories,
  getUnitDefinitions,
  getAvailableComponents,
} from "@/app/(dashboard)/inventory/queries";
import { ItemForm } from "@/app/(dashboard)/inventory/item-form";

export default async function NewProductPage() {
  const [units, categories, components] = await Promise.all([
    getUnitDefinitions(),
    getCategories(),
    getAvailableComponents(),
  ]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-3xl">
        <ItemForm
          itemType="product"
          units={units}
          categories={categories}
          availableComponents={components}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `products/[id]/edit/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import {
  getItem,
  getUnitDefinitions,
  getCategories,
  getBomComponents,
  getAvailableComponents,
} from "@/app/(dashboard)/inventory/queries";
import { ItemForm } from "@/app/(dashboard)/inventory/item-form";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [item, units, categories, bom, components] = await Promise.all([
    getItem(id),
    getUnitDefinitions(),
    getCategories(),
    getBomComponents(id),
    getAvailableComponents(id),
  ]);
  if (!item) redirect("/inventory/products");

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-3xl">
        <ItemForm
          itemType="product"
          units={units}
          categories={categories}
          availableComponents={components}
          initialData={{
            ...item,
            bom: bom.map((b) => ({
              componentId: b.componentId,
              quantity: b.quantity,
              percentage: b.percentage,
            })),
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `products/[id]/page.tsx`**

Mirror the material detail page structure. Add a BOM section between the metadata and Lots sections. Read `app/(dashboard)/inventory/materials/[id]/page.tsx` for the exact pattern, then add:

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { getItem, getLots, getStockMovements, getBomComponents } from "@/app/(dashboard)/inventory/queries";
import { calcStock } from "@/app/(dashboard)/inventory/types";
import { formatPrice } from "@/lib/format";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [item, bom, itemLots, movements] = await Promise.all([
    getItem(id),
    getBomComponents(id),
    getLots(id),
    getStockMovements(id),
  ]);
  if (!item) redirect("/inventory/products");
  const calculatedStock = calcStock(item);

  return (
    <div className="space-y-6 p-6">
      {/* Header — same as material detail but with /inventory/products links */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Link
            href="/inventory/products"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <span aria-hidden>←</span> Back to Products
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{item.name}</h1>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/inventory/products/${id}/edit`}>Edit</Link>
        </Button>
      </div>
      <Separator />

      {item.description && (
        <p className="max-w-2xl text-sm text-muted-foreground">{item.description}</p>
      )}

      {/* Metadata grid — same as material detail plus selling price */}
      <dl className="grid max-w-2xl grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
        {/* SKU, Category, Unit, Purchase Price, Selling Price, Stock, Committed, Expected, Safety Stock, Calculated Stock */}
        {/* Copy the exact structure from materials/[id]/page.tsx, add selling price after purchase price */}
        <div>
          <dt className="text-sm font-medium text-muted-foreground">SKU</dt>
          <dd className="mt-1 text-sm">{item.sku ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Category</dt>
          <dd className="mt-1 text-sm">{item.category ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Unit</dt>
          <dd className="mt-1 text-sm">{item.unitName} ({parseFloat(item.unitSize)} {item.unitUom})</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Purchase Price</dt>
          <dd className="mt-1 text-sm">{formatPrice(item.defaultPurchasePrice) ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Selling Price</dt>
          <dd className="mt-1 text-sm">{formatPrice(item.defaultSellingPrice) ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Stock</dt>
          <dd className="mt-1 text-sm">{parseFloat(item.stock)} {item.unitName}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Committed</dt>
          <dd className="mt-1 text-sm">{parseFloat(item.committedQty)} {item.unitName}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Expected</dt>
          <dd className="mt-1 text-sm">{parseFloat(item.expectedQty)} {item.unitName}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Safety Stock</dt>
          <dd className="mt-1 text-sm">{parseFloat(item.safetyStock)} {item.unitName}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Calculated Stock</dt>
          <dd className="mt-1 text-sm">
            <span className={calculatedStock < 0 ? "inline-flex items-center gap-1.5 text-destructive" : undefined}>
              {calculatedStock < 0 && (
                <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" aria-label="Below safety stock" />
              )}
              {calculatedStock} {item.unitName}
            </span>
          </dd>
        </div>
      </dl>

      {/* BOM Section */}
      {bom.length > 0 && (
        <>
          <Separator />
          <div className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">
              Recipe / Bill of Materials
              {item.bomMode && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({item.bomMode === "percentage" ? "Percentage" : "Quantity"} mode)
                </span>
              )}
            </h2>
            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Component</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Type</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                      {item.bomMode === "percentage" ? "%" : "Qty"}
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {bom.map((b) => (
                    <tr key={b.id} className="border-b last:border-0">
                      <td className="px-4 py-2">{b.componentName}</td>
                      <td className="px-4 py-2">
                        <Badge variant="outline">{b.componentItemType}</Badge>
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        {item.bomMode === "percentage"
                          ? (b.percentage ? `${parseFloat(b.percentage)}%` : "—")
                          : (b.quantity ? parseFloat(b.quantity) : "—")}
                      </td>
                      <td className="px-4 py-2 text-right">{b.componentUnit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Lots and Stock Movements — same as material detail page */}
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
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Quantity</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Lot</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => {
                  const qty = parseFloat(m.quantity);
                  return (
                    <tr key={m.id} className="border-b last:border-0">
                      <td className="px-4 py-2">{m.createdAt.toLocaleDateString("en-US")}</td>
                      <td className={`px-4 py-2 text-right font-mono ${qty > 0 ? "text-foreground" : "text-destructive"}`}>
                        {qty > 0 ? "+" : ""}{qty}
                      </td>
                      <td className="px-4 py-2 font-mono">{m.lotNumber ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify build passes**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/(dashboard)/inventory/products/
git commit -m "feat: create product pages (new, detail, edit) with BOM display"
```

---

## Chunk 3: Verification & Cleanup

### Task 9: Full build verification and manual test

- [ ] **Step 1: Run full build**

```bash
pnpm build
```

Expected: PASS with no type errors

- [ ] **Step 2: Run dev server and manually verify**

```bash
pnpm dev
```

Test checklist:
1. Create a material with selling price — verify it saves and displays
2. Edit a material — verify selling price appears and updates
3. Create a product with no BOM — verify it works like materials
4. Create a product with BOM (quantity mode) — add 2-3 ingredients, verify save
5. Edit the product — verify BOM loads correctly and can be modified
6. View product detail — verify BOM table displays correctly
7. Switch BOM mode to percentage — verify column header changes and total displays
8. Delete a material that is NOT a BOM component — verify success
9. Try to delete a material that IS a BOM component — verify friendly error
10. Products list page — verify products appear in table

- [ ] **Step 3: Run lint**

```bash
pnpm lint
```

Fix any lint errors.

- [ ] **Step 4: Final commit if any fixes needed**

Stage only the specific files that were fixed, then commit:

```bash
git add <specific files that were changed>
git commit -m "fix: address build/lint issues from product form implementation"
```
