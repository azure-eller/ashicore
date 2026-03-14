# Calculated Stock & Safety Stock Alerts Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface stock health in the inventory UI — calculated stock column, safety stock alerts, editable safety stock, and detail page breakdown.

**Architecture:** Frontend-computed stock calculation using existing DB columns. No migrations. DAL queries gain three new fields, UI components display them with alert indicators when calculated stock drops below zero.

**Tech Stack:** Next.js App Router, Drizzle ORM, TanStack Table, react-hook-form, Zod, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-03-13-calculated-stock-alerts-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `app/(dashboard)/inventory/types.ts` | Modify | Add 3 fields to `ItemRow`, add `calcStock` helper |
| `lib/schemas/items.ts` | Modify | Un-omit `safetyStock`, add Zod override |
| `app/(dashboard)/inventory/queries.ts` | Modify | Add 3 fields to `getItems()` and `getItem()` selects |
| `app/(dashboard)/inventory/columns.tsx` | Modify | Add "Calculated Stock" column, red dot on name column |
| `app/(dashboard)/inventory/materials/material-form.tsx` | Modify | Add safety stock field, update layout/legend |
| `app/(dashboard)/inventory/materials/[id]/page.tsx` | Modify | Add stock breakdown with alert indicator |

---

## Chunk 1: Data Layer

### Task 1: Add stock fields to ItemRow and calcStock helper

**Files:**
- Modify: `app/(dashboard)/inventory/types.ts`

- [ ] **Step 1: Add fields to ItemRow type**

Open `app/(dashboard)/inventory/types.ts`. Add three new fields after `inStock`:

```ts
export type ItemRow = {
  id: string;
  name: string;
  sku: string | null;
  itemType: ItemType;
  inStock: string;
  committedQty: string;
  expectedQty: string;
  safetyStock: string;
  unit: string;
  category: string | null;
};
```

- [ ] **Step 2: Add calcStock helper function**

Add below `ItemRow` in the same file:

```ts
export function calcStock(
  row: Pick<ItemRow, "inStock" | "committedQty" | "expectedQty" | "safetyStock">,
): number {
  return (
    parseFloat(row.inStock) -
    parseFloat(row.committedQty) +
    parseFloat(row.expectedQty) -
    parseFloat(row.safetyStock)
  );
}
```

This uses `Pick<ItemRow, ...>` so it works with both `ItemRow` (table) and the `getItem()` return (detail page) via structural typing.

- [ ] **Step 3: Verify no type errors**

Run: `pnpm build`

Expected: Build will fail — `getItems()` in `queries.ts` returns `ItemRow[]` but doesn't include the three new fields yet. This is expected; Task 2 fixes it.

### Task 2: Add stock fields to DAL queries

**Files:**
- Modify: `app/(dashboard)/inventory/queries.ts`

- [ ] **Step 1: Add fields to getItems() select**

In `queries.ts`, find the `getItems()` function's `.select()` block (around line 26). Add three fields after `inStock: inStockSubquery`:

```ts
.select({
  id: items.id,
  name: items.name,
  sku: items.sku,
  itemType: items.itemType,
  inStock: inStockSubquery,
  committedQty: items.committedQty,
  expectedQty: items.expectedQty,
  safetyStock: items.safetyStock,
  unit: unitDefinitions.name,
  category: items.category,
})
```

Note: `inStock` is a subquery from the `lots` table. The three new fields are direct columns on `items` — they just need to be added to the select.

- [ ] **Step 2: Add fields to getItem() select**

In `queries.ts`, find the `getItem()` function's `.select()` block (around line 46). Add three fields after `inStock: inStockSubquery`:

```ts
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
  committedQty: items.committedQty,
  expectedQty: items.expectedQty,
  safetyStock: items.safetyStock,
  unitName: unitDefinitions.name,
  unitSize: unitDefinitions.size,
  unitUom: unitDefinitions.uom,
})
```

- [ ] **Step 3: Verify build passes**

Run: `pnpm build`

Expected: PASS — `getItems()` now returns all fields expected by `ItemRow`.

- [ ] **Step 4: Commit**

```bash
git add app/\(dashboard\)/inventory/types.ts app/\(dashboard\)/inventory/queries.ts
git commit -m "feat: add stock fields to ItemRow and DAL queries"
```

### Task 3: Un-omit safetyStock from Zod schema

**Files:**
- Modify: `lib/schemas/items.ts`

- [ ] **Step 1: Add safetyStock override and remove from omit**

In `lib/schemas/items.ts`:

1. Add `safetyStock: z.string().default("0"),` to the `createInsertSchema` refinements object (alongside `name`, `itemType`, etc.).
2. Remove `safetyStock: true,` from the `.omit()` block.

The result should look like:

```ts
export const insertItemSchema = createInsertSchema(items, {
  name: z.string().min(1, "Name is required"),
  itemType: z.enum(["product", "material"]),
  unitDefinitionId: z.string().min(1, "Unit is required"),
  sku: nullableString,
  category: nullableString,
  defaultPurchasePrice: nullableString,
  description: nullableString,
  safetyStock: z.string().default("0"),
}).omit({
  id: true,
  organizationId: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  committedQty: true,
  expectedQty: true,
  defaultSellingPrice: true,
}).extend({
  initialStock: z.string().default("0"),
});
```

Note: `safetyStock` removed from `.omit()`, `committedQty` and `expectedQty` stay omitted (system-managed). `updateItemSchema` derives from `insertItemSchema` and will automatically include `safetyStock`.

Note: `createItemWithLot` in `queries.ts` receives `Omit<InsertItem, "initialStock">` and spreads it into `tx.insert(items).values({ ...data, organizationId: orgId })`. Since `safetyStock` is now part of `InsertItem`, it flows through the spread automatically — no changes needed to `createItemWithLot` or the API routes.

- [ ] **Step 2: Verify build passes**

Run: `pnpm build`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add lib/schemas/items.ts
git commit -m "feat: add safetyStock to insert/update schemas"
```

---

## Chunk 2: Table UI

### Task 4: Add Calculated Stock column and alert indicator

**Files:**
- Modify: `app/(dashboard)/inventory/columns.tsx`

- [ ] **Step 1: Import calcStock**

Add to the imports at top of `columns.tsx`:

```ts
import { calcStock } from "./types";
```

- [ ] **Step 2: Add Calculated Stock column definition**

Insert a new column definition at array index 4 (after the `inStock` column, before `unit`). The column uses `id` instead of `accessorKey` since it's a computed value:

```ts
{
  id: "calculatedStock",
  sortingFn: (rowA, rowB) => calcStock(rowA.original) - calcStock(rowB.original),
  header: ({ column }) => (
    <SortableHeader column={column} label="Calculated Stock" />
  ),
  cell: ({ row }) => {
    const value = calcStock(row.original);
    return (
      <span className={value < 0 ? "text-destructive" : undefined}>
        {value}
      </span>
    );
  },
},
```

- [ ] **Step 3: Add red dot to name column cell**

Modify the existing `name` column's `cell` function to show a red dot when calculated stock is below zero. Replace the current cell:

```ts
cell: ({ row }) => {
  // TODO: /inventory/products/[id] does not exist yet — will 404 for product rows
  const isLow = calcStock(row.original) < 0;
  return (
    <Link
      href={`/inventory/${ITEM_TYPE_SEGMENTS[row.original.itemType]}/${row.original.id}`}
      className="inline-flex items-center gap-1.5 hover:underline"
    >
      {isLow && (
        <span
          className="h-2 w-2 shrink-0 rounded-full bg-destructive"
          aria-label="Below safety stock"
        />
      )}
      {row.getValue("name")}
    </Link>
  );
},
```

- [ ] **Step 4: Verify build passes**

Run: `pnpm build`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/\(dashboard\)/inventory/columns.tsx
git commit -m "feat: add calculated stock column with alert indicator"
```

---

## Chunk 3: Material Form

### Task 5: Add safety stock field to material form

**Files:**
- Modify: `app/(dashboard)/inventory/materials/material-form.tsx`

Reference docs before editing: read `docs/references/field-example.md` and `docs/references/react-hook-form-example.md` for form patterns.

- [ ] **Step 1: Add safetyStock to initialData interface**

In `material-form.tsx`, find the `MaterialFormProps` interface (around line 63). Add `safetyStock: string` to the `initialData` type:

```ts
initialData?: {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  description: string | null;
  unitDefinitionId: string;
  unitName: string;
  unitSize: string;
  unitUom: string;
  defaultPurchasePrice: string | null;
  inStock: string;
  safetyStock: string;
};
```

- [ ] **Step 2: Add safetyStock to defaultValues**

In the `useForm` call (around line 108), add `safetyStock` to both branches:

**Edit mode** — add to the `initialData` branch (after `defaultPurchasePrice`):
```ts
safetyStock: String(parseFloat(initialData.safetyStock)),
```

**Create mode** — add to the else branch:
```ts
safetyStock: "0",
```

- [ ] **Step 3: Update fieldset legend and description**

Find the FieldSet around line 371. Change the legend from conditional to always show "Pricing & Stock":

```tsx
<FieldLegend>Pricing & Stock</FieldLegend>
<FieldDescription>
  {initialData
    ? "Update the default purchase price and safety stock threshold for this material."
    : "Set the default purchase price and starting inventory."}
</FieldDescription>
```

- [ ] **Step 4: Update grid layout to always use 2-column grid**

Find the `div` wrapper around line 379. Change it from conditional to always use the grid:

```tsx
<div className="grid grid-cols-2 gap-4">
```

Remove the conditional: `className={initialData ? undefined : "grid grid-cols-2 gap-4"}` becomes `className="grid grid-cols-2 gap-4"`.

- [ ] **Step 5: Add Safety Stock field**

After the closing `)}` of the Initial Stock `Controller` block (and after the `{!initialData && (...)}` conditional), add the Safety Stock field. It should be inside the grid `div`, after the Initial Stock conditional:

```tsx
<Controller
  name="safetyStock"
  control={form.control}
  render={({ field, fieldState }) => (
    <Field data-invalid={fieldState.invalid}>
      <FieldLabel htmlFor={field.name}>Safety Stock</FieldLabel>
      <Input
        {...field}
        id={field.name}
        value={field.value ?? ""}
        aria-invalid={fieldState.invalid}
        placeholder="0"
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

Place this Controller after the `{!initialData && (...)}` conditional block for Initial Stock, but still inside the grid `<div>` (before the closing `</div>` at approximately line 426 in the original file). This renders in both create and edit mode. In create mode the grid is: Purchase Price | Initial Stock | Safety Stock (wraps to second row). In edit mode: Purchase Price | Safety Stock.

- [ ] **Step 6: Verify build passes**

Run: `pnpm build`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/\(dashboard\)/inventory/materials/material-form.tsx
git commit -m "feat: add safety stock field to material form"
```

---

## Chunk 4: Detail Page

### Task 6: Add stock breakdown to detail page

**Files:**
- Modify: `app/(dashboard)/inventory/materials/[id]/page.tsx`

- [ ] **Step 1: Import calcStock**

Add to the imports at top of `page.tsx`:

```ts
import { calcStock } from "@/app/(dashboard)/inventory/types";
```

- [ ] **Step 2: Add stock breakdown fields to the dl grid**

Find the existing "In Stock" `<div>` in the `<dl>` grid (around line 64). After it, add four new definition items:

```tsx
<div>
  <dt className="text-sm font-medium text-muted-foreground">Committed</dt>
  <dd className="mt-1 text-sm">
    {parseFloat(item.committedQty)} {item.unitName}
  </dd>
</div>
<div>
  <dt className="text-sm font-medium text-muted-foreground">Expected</dt>
  <dd className="mt-1 text-sm">
    {parseFloat(item.expectedQty)} {item.unitName}
  </dd>
</div>
<div>
  <dt className="text-sm font-medium text-muted-foreground">Safety Stock</dt>
  <dd className="mt-1 text-sm">
    {parseFloat(item.safetyStock)} {item.unitName}
  </dd>
</div>
<div>
  <dt className="text-sm font-medium text-muted-foreground">
    Calculated Stock
  </dt>
  <dd className="mt-1 text-sm">
    {(() => {
      const value = calcStock(item);
      return (
        <span className={value < 0 ? "inline-flex items-center gap-1.5 text-destructive" : undefined}>
          {value < 0 && (
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-destructive"
              aria-label="Below safety stock"
            />
          )}
          {value} {item.unitName}
        </span>
      );
    })()}
  </dd>
</div>
```

- [ ] **Step 3: Verify build passes**

Run: `pnpm build`

Expected: PASS

- [ ] **Step 4: Manual test**

Run: `pnpm dev`

Verify:
1. Inventory table shows "Calculated Stock" column after "In Stock"
2. Items with calculated stock < 0 show red dot next to name and red text in the calculated stock cell
3. Calculated Stock column is sortable
4. Material detail page shows Committed, Expected, Safety Stock, and Calculated Stock fields
5. Material form (both create and edit) shows Safety Stock field
6. Saving safety stock value works in both create and edit mode

- [ ] **Step 5: Commit**

```bash
git add app/\(dashboard\)/inventory/materials/\[id\]/page.tsx
git commit -m "feat: add stock breakdown to material detail page"
```

---

## Final Verification

- [ ] **Run full build**: `pnpm build` — should pass with zero type errors
- [ ] **Run lint**: `pnpm lint` — should pass with no new warnings
