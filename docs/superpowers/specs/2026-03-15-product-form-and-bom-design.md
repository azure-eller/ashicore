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

### `items` table — add `bomMode` column

Add a nullable `bom_mode` column to persist the per-recipe quantity-vs-percentage toggle:
```
bomMode: varchar("bom_mode", { length: 20 })  // "quantity" | "percentage" | null
```

Null means no BOM / not applicable (materials). When a product has a BOM, this is set to either `"quantity"` or `"percentage"`. This requires a migration.

The `default_selling_price` column already exists. Only the Zod schema needs updating.

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

Note: The RLS policy SQL must reference the renamed `item_id` column. Since Drizzle generates the policy from the schema code, updating the Drizzle schema and regenerating the migration will handle this.

One of `quantity` or `percentage` is filled per row (not both). Which one is used is determined by the `bomMode` on the parent item.

### Zod schema changes (`lib/schemas/items.ts`)

- **Remove `defaultSellingPrice` from the `.omit({})` block** in `insertItemSchema`. Define it as `nullableString` in the `createInsertSchema` overrides (same pattern as `defaultPurchasePrice`). Note: DB precision is `numeric(10,2)` for selling price vs `numeric(10,4)` for purchase price — this is intentional (price vs cost).
- Add `bomMode` as `z.enum(["quantity", "percentage"]).nullable().optional()`
- Add optional `bom` array field to `insertItemSchema`:
  ```typescript
  bom: z.array(z.object({
    componentId: z.string().min(1, "Component is required"),
    quantity: nullableString,
    percentage: nullableString,
  })).optional()
  ```
- Add a `.superRefine()` that validates: when `bomMode` is `"quantity"`, every BOM row must have `quantity` non-null and `percentage` null; when `bomMode` is `"percentage"`, every BOM row must have `percentage` non-null and `quantity` null.
- Same fields added to `updateItemSchema`

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
    bomMode: "quantity" | "percentage" | null;
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

**Layout:** Table rows
- Uses shadcn `Table` component (not TanStack Table)
- Column headers: Component | Quantity (or Percentage) | Unit | ×
- Rows managed by `useFieldArray` from react-hook-form

**Per-recipe toggle** at the top of the BOM section switches between Quantity and Percentage mode. The toggle value is stored as `bomMode` on the form. Column header updates accordingly. In percentage mode, a running total is displayed so the user can see if rows add up to 100%.

**Each row:**
- Component: `Combobox` (search items by name, shows item type badge like "material" or "product")
- Quantity/Percentage: `Input` (decimal)
- Unit: read-only text (auto-filled from selected component's unit definition)
- Delete: `×` button

**Add button:** `+ Add Ingredient` below the table, appends a new empty row.

## API Changes

### `POST /api/items` — extended

Request body accepts optional `bomMode` and `bom` array when creating a product. Creates item and BOM components in a single transaction via `withAuthedOrgContext`.

### `PUT /api/items/[id]` — extended

Request body accepts optional `bomMode` and `bom` array. In a transaction: updates item (including `bomMode`), hard-deletes existing BOM components, inserts new ones. (Hard delete on line items per CLAUDE.md convention.) Note: `created_at` on BOM rows resets on every save — this is acceptable for line items; the parent item's `updated_at` provides the audit timestamp.

### `DELETE /api/items/[id]` — FK error handling

The `component_id` FK uses `onDelete: "restrict"`, meaning deleting an item that is used as a BOM component of another product will fail with a Postgres FK violation (error code `23503`). The DELETE handler must catch this and return a user-friendly 400 response: `{ error: "Cannot delete: this item is used as a component in other products." }`

### No separate BOM endpoints

BOM is always saved atomically with the item. Fewer endpoints, simpler mental model.

## Query Changes (`inventory/queries.ts`)

### Modified

- `getItem(id)` — no change to this function itself. Product pages call `getItem` and `getBomComponents` separately and merge in the page server component. This is simpler and consistent with the existing pattern of composing data in page components.

### New

- `getBomComponents(itemId)` — returns BOM rows with joined component name, itemType, and unit info. Used by both the product detail page (read-only display) and the edit page (form population).
- `getAvailableComponents(excludeItemId?)` — returns all non-deleted items (`WHERE deleted_at IS NULL`) for combobox picker, excluding the specified item to prevent self-reference.

### Circular BOM references

Direct self-reference is prevented by the DB check constraint (`item_id != component_id`). Indirect cycles (A → B → A) are **not** validated at save time — this is deferred. If a cycle exists, it will surface at Manufacturing Order creation time when ingredient quantities are calculated. This is acceptable for MVP; cycle detection can be added later as a save-time validation if needed.

## Page Structure

### Modified files

- `lib/db/schema/bom.ts` — updated schema (rename, column drops)
- `lib/db/schema/items.ts` — add `bomMode` column
- `lib/schemas/items.ts` — remove `defaultSellingPrice` from `.omit()`, add it as `nullableString`, add `bomMode`, add `bom` array, add `.superRefine()` for mode validation
- `app/(dashboard)/inventory/queries.ts` — add BOM queries
- `app/api/items/route.ts` — handle `bomMode` + `bom` in POST
- `app/api/items/[id]/route.ts` — handle `bomMode` + `bom` in PUT, catch FK violation in DELETE
- `app/(dashboard)/inventory/materials/new/page.tsx` — use `ItemForm` instead of `MaterialForm`
- `app/(dashboard)/inventory/materials/[id]/edit/page.tsx` — use `ItemForm` instead of `MaterialForm`

### New files

- `app/(dashboard)/inventory/item-form.tsx` — unified form component
- `app/(dashboard)/inventory/bom-editor.tsx` — BOM table sub-component
- `app/(dashboard)/inventory/products/new/page.tsx` — create product page
- `app/(dashboard)/inventory/products/[id]/page.tsx` — product detail page
- `app/(dashboard)/inventory/products/[id]/edit/page.tsx` — edit product page
- `lib/schemas/bom.ts` — Zod schema for BOM validation

### Deleted files

- `app/(dashboard)/inventory/materials/material-form.tsx` — replaced by `item-form.tsx`

### Already exists (no changes needed)

- `app/(dashboard)/inventory/products/page.tsx` — products list page (already works, uses shared `DataTable` with `itemType="product"` filter)

## Patterns Maintained

- All data access via `withAuthedOrgContext` — no direct DB imports
- Zod schemas derived from Drizzle with `createInsertSchema()`
- API routes wrapped with `apiHandler`
- Forms use react-hook-form + `zodResolver` with `mode: "onBlur"`
- Mutations use TanStack Query, `isPending` for loading, no optimistic updates
- Inline field errors via `FieldError`, no toasts for validation
- shadcn components only, HugeIcons only, semantic color tokens only
- RLS on all inventory tables, soft deletes on master data, hard deletes on line items
