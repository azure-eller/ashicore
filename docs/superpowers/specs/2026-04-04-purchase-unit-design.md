# Purchase Unit Design

## Summary

Add an optional purchasing unit to items, separate from the stocking unit. The stocking unit is used for BOMs, manufacturing, and inventory tracking. The purchasing unit is used only on purchase orders, with a conversion factor to auto-convert received quantities to stocking units. Rename all "Unit" labels across the app to "Stocking Unit."

## Context

- Materials are purchased in bulk (e.g., 50 lb bags of Citric Acid) but measured in recipe units on the manufacturing floor (e.g., cups, tablespoons)
- The current system has one unit per item (`unit_definition_id`) used everywhere
- BOMs and manufacturing orders already use this unit — no conversion exists
- The `convert` npm library is installed but only used for unit validation, not conversion
- Katana MRP uses this two-unit model: stock UoM for everything, purchase UoM just for procurement

## Design Decisions

**Two-unit model (Katana-style), not three.** No separate selling unit. The stocking unit IS the recipe unit. If selling units are needed later, add a third field — the model extends naturally.

**Purchase unit references `unit_definitions`.** Not a free-text label. This enables auto-conversion when both units share a measure category (via the `convert` library) and keeps the data model consistent.

**Conversion factor only for cross-measure.** Same-category conversions (lb → 50 lb bag, gallon → liter) are auto-calculated from unit definition metadata. Cross-category conversions (cup → lb) require a user-entered factor because they depend on material density.

## Schema Changes

### `items` table

Rename and add columns:

```sql
-- Rename existing column
ALTER TABLE inventory.items RENAME COLUMN unit_definition_id TO stocking_unit_definition_id;

-- Add purchasing unit (optional)
ALTER TABLE inventory.items
  ADD COLUMN purchase_unit_definition_id UUID
    REFERENCES inventory.unit_definitions(id),
  ADD COLUMN purchase_conversion_factor NUMERIC(12, 4);
```

- `stocking_unit_definition_id` — required, FK to unit_definitions. Used for BOMs, manufacturing, inventory display.
- `purchase_unit_definition_id` — optional, FK to unit_definitions. Used on purchase orders.
- `purchase_conversion_factor` — how many stocking units per 1 purchase unit. Required when purchase unit is cross-measure. Auto-calculated and stored when same-measure. Null when no purchase unit.

### Drizzle schema update

In `lib/db/schema/items.ts`:

```ts
// Rename
stockingUnitDefinitionId: uuid("stocking_unit_definition_id")
  .notNull()
  .references(() => unitDefinitions.id),

// New
purchaseUnitDefinitionId: uuid("purchase_unit_definition_id")
  .references(() => unitDefinitions.id),
purchaseConversionFactor: numeric("purchase_conversion_factor", { precision: 12, scale: 4 }),
```

### Migration notes

- Column rename from `unit_definition_id` to `stocking_unit_definition_id`
- No data migration needed — existing rows keep their values
- All existing code references to `unitDefinitionId` must update to `stockingUnitDefinitionId`
- Grant `app_user` access to new columns (covered by existing table grants)

## UI Changes

### Global rename

Every instance of "Unit" referring to an item's unit across the app becomes "Stocking Unit":
- Item form labels
- BOM editor column header
- Manufacturing order ingredients table
- Inventory list/detail pages
- Data table columns
- Any other surface that displays an item's unit

### Item form — purchasing unit section

Located in the "Basics" section, below the stocking unit picker:

1. **Stocking unit** — required picker, always visible (existing, just relabeled)
2. **Checkbox: "Purchased in a different unit"** — unchecked by default, reveals purchase unit fields when checked
3. **Purchase unit picker** — same unit definition dropdown, shown when checkbox is checked
4. **Conversion factor input** — conditionally shown:
   - Same measure category (both weight, both volume, etc.) → auto-calculated silently, field not shown
   - Cross-measure category (weight ↔ volume) → input field appears on purchase unit blur, labeled "How many [stocking unit name] per 1 [purchase unit name]?"

When editing an item that already has a purchase unit, the checkbox starts checked and the fields are pre-populated. Unchecking the checkbox clears the purchase unit and conversion factor on save.

### Purchase orders

When an item has a purchase unit:
- PO line quantities are entered and displayed in the purchase unit
- On receiving, quantities are multiplied by the conversion factor and added to inventory in stocking units
- PO line should show both: "10 Pounds (= 19.2 Cups)" or similar

When an item has no purchase unit:
- PO behavior is unchanged, quantities in stocking units

### BOM editor

No functional change. The unit column already shows the component's unit — it will now show the stocking unit (which it already does). Column header changes from "Unit" to "Stocking Unit."

### Manufacturing orders

No functional change. Ingredient quantities and units already come from the BOM in stocking units. Column header changes from "Unit" to "Stocking Unit."

### Inventory list and detail pages

No functional change to data. Unit column headers change to "Stocking Unit." Item detail page could optionally show the purchase unit info if set.

## Conversion Logic

### Same-category auto-conversion

When both stocking and purchase units share a `uom` measure category (per the `convert` library):

```ts
import convert from "convert";

// Example: stocking = Pound (size=1, uom=lb), purchase = 50 lb Bag (size=50, uom=lb)
// factor = purchaseSize / stockingSize (in same base unit)
const factor = convert(purchaseUnit.size, purchaseUnit.uom)
  .to(stockingUnit.uom) / stockingUnit.size;
```

### Cross-category manual conversion

When the measure categories differ (e.g., volume vs weight), the user must enter the factor manually. The system validates that:
- The factor is a positive number
- It is required when a purchase unit is set and categories differ

### Receiving conversion

When a PO line is received:

```ts
const stockingQty = receivedQty * item.purchaseConversionFactor;
// Add stockingQty to inventory in stocking units
```

## Affected Code Paths

### Must update (column rename)

Every file that references `unitDefinitionId` on items must change to `stockingUnitDefinitionId`:
- `lib/db/schema/items.ts` — column definition
- `app/(dashboard)/inventory/queries.ts` — all DAL queries joining on this column
- `app/(dashboard)/inventory/item-form.tsx` — form field name
- `lib/schemas/items.ts` — Zod schema field name
- `app/api/items/` — API routes
- `app/(dashboard)/manufacturing/queries.ts` — MO ingredient queries
- `app/(dashboard)/sales/queries.ts` — any item joins
- Any other file joining items to unit_definitions

### Must update (label rename)

Every UI component displaying an item's unit label changes "Unit" → "Stocking Unit":
- BOM editor column header
- Manufacturing order form ingredients table
- Inventory data tables (materials, products)
- Item detail pages
- Item form field label
- Any loading skeletons referencing unit labels

### New code

- Purchase unit picker + checkbox in item form
- Conversion factor auto-calculation utility
- Conversion factor input (conditional)
- Purchase unit display on item detail page
- PO integration (when POs exist — this can be deferred if POs aren't built yet)

## Out of Scope

- Selling units — not needed now, can add later as a third unit field
- Unit conversion table (full multi-unit system) — unnecessary complexity
- Changing existing material stocking units — users do this manually as they adopt the feature
- Purchase order integration — depends on PO feature status, can be a follow-up
