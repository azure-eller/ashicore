# Product Form & BOM Editor Design

## Summary

Unify the material and product forms into a single `ItemForm` component. Add a BOM (Bill of Materials) editor that renders conditionally for products. Add selling price to both materials and products. Clean up the existing `bom_components` schema.

## Context

- Materials and products share the same `items` table, differentiated by `itemType`
- The `bom_components` table already exists but needs schema cleanup
- The material form (`material-form.tsx`) is the established pattern for forms in this app
- Products can be BOM components of other products (sub-assemblies)
- BOM supports two modes: quantity-per-unit or percentage-based, toggled per recipe (not per row)

## Manufacturing Model (Informing BOM Design)

The BOM defines ingredients per 1 unit of output. When a Manufacturing Order is created for N units, the system multiplies all ingredients by N. On completion, materials are deducted based on BOM ratios × actual output quantity. No yield tracking, no per-ingredient actual-vs-planned — drift is handled by periodic stock counts and manual adjustments.

Products can appear in other products' BOMs. Example:
- "Premium Garden Mix" (bulk, per yd³) — BOM: 0.4 yd³ topsoil + 0.3 yd³ compost + 0.3 yd³ perlite
- "Bagged Premium Mix" (per bag) — BOM: 0.037 yd³ Premium Garden Mix + 1 plastic bag

## Schema Changes

### `bom_components` table — cleanup

Current columns to **drop**:
- `uom` — unit comes from the component item's `unitDefinitionId` (joined at query time)
- `sort_order` — unnecessary complexity

Current columns to **rename**:
- `parent_item_id` → `item_id` — simpler, consistent naming

**Final schema:**
```
bom_components:
  id              uuid PK
  item_id         uuid FK → items (the product this BOM belongs to), cascade delete
  component_id    uuid FK → items (the ingredient), restrict delete
  quantity        numeric(12,4), nullable
  percentage      numeric(5,2), nullable
  created_at      timestamp
  updated_at      timestamp

Constraints:
  unique(item_id, component_id)
  check: item_id != component_id
  RLS: item_id IN (SELECT id FROM inventory.items WHERE organization_id = current_setting('app.current_org_id', true))
```

One of `quantity` or `percentage` is filled per row (not both). Which one is used is determined by the recipe mode (per-recipe toggle, not per-row).

### `items` table — no changes

The `default_selling_price` column already exists. Only the Zod schema needs updating.

### Zod schema changes (`lib/schemas/items.ts`)

- Add `defaultSellingPrice` as `nullableString` (same pattern as `defaultPurchasePrice`)
- Add optional `bom` array field to `insertItemSchema`:
  ```typescript
  bom: z.array(z.object({
    componentId: z.string().min(1, "Component is required"),
    quantity: nullableString,
    percentage: nullableString,
  })).optional()
  ```
- Same field added to `updateItemSchema`

### New Zod schema (`lib/schemas/bom.ts`)

Standalone schema for BOM component validation, derived from Drizzle table with `createInsertSchema()`. Used for API-level validation.

## Unified Item Form

### Approach

Delete `material-form.tsx`. Create `item-form.tsx` at `app/(dashboard)/inventory/item-form.tsx` (shared location, alongside existing shared files like `data-table.tsx` and `queries.ts`).

### Props

```typescript
interface ItemFormProps {
  itemType: "material" | "product";
  units: { id: string; name: string; size: string; uom: string }[];
  categories: string[];
  availableComponents?: { id: string; name: string; itemType: string; unit: string }[];
  initialData?: {
    // ... existing material fields ...
    defaultSellingPrice: string | null;
    bom?: { componentId: string; quantity: string | null; percentage: string | null }[];
  };
}
```

### Changes from material-form.tsx

1. **Component renamed** `MaterialForm` → `ItemForm`
2. **Selling price field** added next to purchase price (both materials and products)
3. **BOM section** renders after Pricing & Stock when `itemType === "product"`
4. **Labels/placeholders** adapt based on `itemType` (e.g., "Add Product", "e.g. Premium Garden Mix")
5. **Mutation** invalidates `["items", itemType]`
6. **Redirect** uses `ITEM_TYPE_SEGMENTS[itemType]` for correct URL path

### BOM Editor Sub-component

Separate file: `app/(dashboard)/inventory/bom-editor.tsx`

**Layout:** Table rows (Option A from mockups)
- Uses shadcn `Table` component (not TanStack Table)
- Column headers: Component | Quantity (or Percentage) | Unit | ×
- Rows managed by `useFieldArray` from react-hook-form

**Per-recipe toggle** at the top of the BOM section switches between Quantity and Percentage mode. Column header updates accordingly. In percentage mode, a running total is displayed.

**Each row:**
- Component: `Combobox` (search items by name, shows item type badge)
- Quantity/Percentage: `Input` (decimal)
- Unit: read-only text (auto-filled from selected component's unit definition)
- Delete: `×` button

**Add button:** `+ Add Ingredient` below the table, appends a new empty row.

## API Changes

### `POST /api/items` — extended

Request body accepts optional `bom` array when creating a product. Creates item and BOM components in a single transaction via `withAuthedOrgContext`.

### `PUT /api/items/[id]` — extended

Request body accepts optional `bom` array. In a transaction: updates item, hard-deletes existing BOM components, inserts new ones. (Hard delete on line items per CLAUDE.md convention.)

### No separate BOM endpoints

BOM is always saved atomically with the item. Fewer endpoints, simpler mental model.

## Query Changes (`inventory/queries.ts`)

### Modified

- `getItem(id)` — also returns BOM components (with component name + unit via join) when item is a product

### New

- `getBomComponents(itemId)` — returns BOM rows with joined component name + unit info (for form population)
- `getAvailableComponents(excludeItemId?)` — returns all non-deleted items for combobox picker, excluding the specified item to prevent self-reference

## Page Structure

### Modified files

- `lib/schemas/items.ts` — add `defaultSellingPrice`, add `bom` array
- `app/(dashboard)/inventory/queries.ts` — add BOM queries
- `app/api/items/route.ts` — handle `bom` in POST
- `app/api/items/[id]/route.ts` — handle `bom` in PUT
- `app/(dashboard)/inventory/materials/new/page.tsx` — use `ItemForm` instead of `MaterialForm`
- `app/(dashboard)/inventory/materials/[id]/edit/page.tsx` — use `ItemForm` instead of `MaterialForm`

### New files

- `app/(dashboard)/inventory/item-form.tsx` — unified form component
- `app/(dashboard)/inventory/bom-editor.tsx` — BOM table sub-component
- `app/(dashboard)/inventory/products/new/page.tsx` — create product page
- `app/(dashboard)/inventory/products/[id]/page.tsx` — product detail page
- `app/(dashboard)/inventory/products/[id]/edit/page.tsx` — edit product page
- `lib/schemas/bom.ts` — Zod schema for BOM validation
- `lib/db/schema/bom.ts` — updated schema (migration needed for rename + column drops)

### Deleted files

- `app/(dashboard)/inventory/materials/material-form.tsx` — replaced by `item-form.tsx`

## Patterns Maintained

- All data access via `withAuthedOrgContext` — no direct DB imports
- Zod schemas derived from Drizzle with `createInsertSchema()`
- API routes wrapped with `apiHandler`
- Forms use react-hook-form + `zodResolver` with `mode: "onBlur"`
- Mutations use TanStack Query, `isPending` for loading, no optimistic updates
- Inline field errors via `FieldError`, no toasts for validation
- shadcn components only, HugeIcons only, semantic color tokens only
- RLS on all inventory tables, soft deletes on master data, hard deletes on line items
