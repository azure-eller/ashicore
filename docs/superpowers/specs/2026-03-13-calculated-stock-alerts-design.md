# Calculated Stock & Safety Stock Alerts

## Overview

Surface stock health in the inventory UI. Add a "Calculated Stock" column to the inventory table, flag items where calculated stock drops below zero, make safety stock editable in the material form, and show a full stock breakdown on the detail page.

## Formula

```
Calculated Stock = In Stock - Committed Qty + Expected Qty - Safety Stock
```

Alert triggers when **Calculated Stock < 0**. Safety stock is baked into the formula — zero is the danger line.

## What's NOT in scope

- Reorder point / reorder quantity fields
- Auto-reorder workflows
- Separate low-stock / out-of-stock status badges
- Email notifications
- Summary stat cards or dashboard widgets

## Data Layer

### Calculation helper (`app/(dashboard)/inventory/types.ts`)

Define `calcStock` in `types.ts` so it's importable by both client components (`columns.tsx`) and the server-rendered detail page. The helper uses `Pick<ItemRow, ...>` so it works with both `ItemRow` (table) and the `getItem()` return type (detail page) via structural typing — both will have identically-named string fields.

```ts
export function calcStock(row: Pick<ItemRow, "inStock" | "committedQty" | "expectedQty" | "safetyStock">): number {
  return parseFloat(row.inStock) - parseFloat(row.committedQty) + parseFloat(row.expectedQty) - parseFloat(row.safetyStock);
}
```

### ItemRow type (`app/(dashboard)/inventory/types.ts`)

Add `committedQty`, `expectedQty`, `safetyStock` (all `string`, matching the Postgres numeric → string pattern used by `inStock`).

### DAL queries (`app/(dashboard)/inventory/queries.ts`)

Note: `inStock` is already computed as a subquery from the `lots` table. The three new fields (`committedQty`, `expectedQty`, `safetyStock`) are direct columns on the `items` table — just add them to the select alongside the existing `inStock` subquery.

- `getItems()` — add `committedQty: items.committedQty`, `expectedQty: items.expectedQty`, `safetyStock: items.safetyStock` to the select.
- `getItem()` — add the same three fields to the select.

### Zod schema (`lib/schemas/items.ts`)

`safetyStock` is currently in the `.omit()` block on `insertItemSchema`. To make it available:

1. Remove `safetyStock` from the `.omit()` block in `insertItemSchema`.
2. Add an explicit override for `safetyStock` in the `createInsertSchema` refinements: `safetyStock: z.string().default("0")`. This ensures empty strings from cleared form fields fall back to the DB default rather than causing a Postgres numeric parse error.
3. No change needed to `updateItemSchema` — it derives from `insertItemSchema` via `.omit()` and will automatically include `safetyStock` once un-omitted.
4. `committedQty` and `expectedQty` remain omitted — system-managed.

## Table UI

### Column layout

```
☐ | Name | SKU | In Stock | Calculated Stock | Unit | Category
```

The existing select (checkbox) column remains unchanged at position 0. Insert the new "Calculated Stock" column definition at array index 4, between `inStock` and `unit`.

### Calculated Stock column (`columns.tsx`)

- Define with `id: "calculatedStock"` (no `accessorKey` since it's a computed value).
- Cell renders the computed value via `calcStock(row.original)`.
- Sortable with `SortableHeader`, custom `sortingFn` using `calcStock` for both rows (same pattern as `inStock`'s `parseFloat` sorting).
- When calculated stock < 0: cell text uses `text-destructive`.

### Name column alert indicator (`columns.tsx`)

- When calculated stock < 0: render a small red dot (`bg-destructive`, `rounded-full`, ~6-8px) inline before the item name.
- Uses `calcStock(row.original)` to determine the condition.

### No row tint

Row background stays unchanged — alert is communicated through the red dot and red text only.

## Material Form

### Safety stock field (`material-form.tsx`)

Add a "Safety Stock" field to the "Pricing & Stock" fieldset.

- Visible in **both create and edit mode**.
- Numeric input, `inputMode="decimal"`, placeholder `"0"`.
- Uses the same Controller + Field/FieldLabel/FieldError pattern as other fields.

### MaterialFormProps.initialData type

Add `safetyStock: string` to the `initialData` interface so the edit form receives and pre-populates the value.

### Default values

- **Edit mode**: add `safetyStock: String(parseFloat(initialData.safetyStock))` to the `defaultValues` object (consistent with how `defaultPurchasePrice` is formatted).
- **Create mode**: add `safetyStock: "0"` to the `defaultValues` object. Zod defaults only apply during parsing (on submit), not as initial form values — so react-hook-form needs an explicit default to avoid an uncontrolled input.

### Layout

- **Edit mode**: 2-column grid — Purchase Price | Safety Stock. Change the wrapping `div` to always use `grid grid-cols-2 gap-4` (currently only applies in create mode).
- **Create mode**: 2-column grid — Purchase Price | Initial Stock on row 1, Safety Stock wraps to row 2.

### Fieldset legend and description

Update the FieldSet legend to show "Pricing & Stock" in both create and edit mode (currently shows "Pricing" in edit mode). Update the edit-mode FieldDescription to: "Update the default purchase price and safety stock threshold for this material."

## Detail Page

### Stock breakdown (`materials/[id]/page.tsx`)

Add to the existing `dl` grid (which uses `sm:grid-cols-2`), after the existing "In Stock" field:

- **Committed** — `parseFloat(item.committedQty)` with unit name
- **Expected** — `parseFloat(item.expectedQty)` with unit name
- **Safety Stock** — `parseFloat(item.safetyStock)` with unit name
- **Calculated Stock** — computed via `calcStock(item)`; when < 0, use `text-destructive` class and render a red dot before the value

All numeric values use `parseFloat()` for display, consistent with how `inStock` is already rendered.

## API

### Update endpoint

The existing `PUT /api/items/[id]` endpoint validates against `updateItemSchema` and spreads data into `.set()`. Once `safetyStock` is un-omitted from the schema, the endpoint handles it automatically — no route changes needed.

### Create endpoint

Same — `POST /api/items` validates against `insertItemSchema`. Un-omitting `safetyStock` from the schema is sufficient.

## Computation approach

All calculation happens in the **frontend** via the `calcStock` helper. No SQL-level computed columns or query changes beyond selecting the raw fields. Rationale:

- The formula is trivial arithmetic.
- TanStack Table already handles client-side sorting (matching the `inStock` pattern).
- Avoids coupling the presentation formula to the query layer.
