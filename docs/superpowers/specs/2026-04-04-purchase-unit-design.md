# Purchase Unit Design Spec

## Summary

Add an optional purchase unit to items, separate from the existing canonical unit used for BOMs, manufacturing, stock, and inventory math. In UI, that canonical unit is labeled "Stocking Unit." Purchase orders use the purchase unit when present, while the system stores frozen stock-equivalent quantities and costs on PO lines so receiving, valuation, and `expectedQty` remain simple and historically stable.

## Context

- Materials are often purchased in packs or vendor units (e.g. 50 lb bag, 5 gal pail) but stocked and consumed in a different unit on the floor
- The current system has one item unit used everywhere
- BOMs, manufacturing, stock movements, lots, and inventory math already assume one canonical item unit
- Purchase orders already use snapshot lines and `expectedQty` is recomputed from saved PO line quantities
- The `convert` npm library is already available for same-measure conversion

## Design Decisions

**Two-unit model, not a generic conversion engine.** Keep one canonical item unit for inventory math and add one optional purchase unit for procurement only.

**Keep the existing item column as the canonical stock unit in storage.** Treat the current `unit_definition_id` as the stocking unit. Relabel surfaces to "Stocking Unit" in UI and app types. Do not rename the database column in this pass.

**Store purchase conversion on the item, but freeze it on PO lines.** Item-level configuration drives new purchase orders. Saved purchase orders snapshot the purchase unit label, conversion factor, purchase quantities, stock-equivalent quantities, and normalized stock-unit cost so old orders do not change meaning if the item is edited later.

**Auto-convert only when the units are compatible.** Same-measure conversions are derived automatically from unit metadata. Cross-measure conversions require a manual factor because they depend on material-specific density or packing assumptions.

## Schema Changes

### `items` table

Add optional purchasing metadata to the existing item unit model:

```sql
ALTER TABLE inventory.items
  ADD COLUMN purchase_unit_definition_id UUID
    REFERENCES inventory.unit_definitions(id),
  ADD COLUMN purchase_to_stock_factor NUMERIC(12, 4);
```

- `unit_definition_id` remains the canonical stock unit in storage
- `purchase_unit_definition_id` is optional and only affects procurement
- `purchase_to_stock_factor` means "stocking units per 1 purchase unit"
- If `purchase_unit_definition_id` is null, the item is purchased directly in stocking units

### `purchase_order_lines` table

Extend PO line snapshots so purchasing remains frozen after save:

```sql
ALTER TABLE purchasing.purchase_order_lines
  ADD COLUMN purchase_unit_name VARCHAR(50) NOT NULL DEFAULT '',
  ADD COLUMN stocking_unit_name VARCHAR(50) NOT NULL DEFAULT '',
  ADD COLUMN purchase_to_stock_factor NUMERIC(12, 4) NOT NULL DEFAULT 1,
  ADD COLUMN stock_quantity_ordered NUMERIC(12, 4) NOT NULL DEFAULT 0,
  ADD COLUMN stock_quantity_received NUMERIC(12, 4) NOT NULL DEFAULT 0,
  ADD COLUMN stock_unit_cost NUMERIC(10, 4) NOT NULL DEFAULT 0;
```

Meaning:

- `quantityOrdered` / `quantityReceived` stay in the user-entered purchase unit for PO workflow
- `stockQuantityOrdered` / `stockQuantityReceived` store the converted stocking-unit quantities
- `purchaseUnitName` is the visible PO unit snapshot
- `stockingUnitName` is the canonical inventory unit snapshot
- `purchaseToStockFactor` freezes the factor used by that line
- `stockUnitCost` stores cost per stocking unit for lot valuation

For items with no separate purchase unit:

- `purchaseUnitName = stockingUnitName`
- `purchaseToStockFactor = 1`
- `quantity*` and `stockQuantity*` are equal
- `unitCost = stockUnitCost`

### Drizzle schema update

In `lib/db/schema/items.ts`:

```ts
purchaseUnitDefinitionId: uuid("purchase_unit_definition_id")
  .references(() => unitDefinitions.id),
purchaseToStockFactor: numeric("purchase_to_stock_factor", {
  precision: 12,
  scale: 4,
}),
```

In `lib/db/schema/purchasing.ts` add the new PO line snapshot columns listed above.

### Migration notes

- Do not rename `inventory.items.unit_definition_id`
- Backfill existing `purchase_order_lines` with:
  - `purchaseUnitName = unitName`
  - `stockingUnitName = unitName`
  - `purchaseToStockFactor = 1`
  - `stockQuantityOrdered = quantityOrdered`
  - `stockQuantityReceived = quantityReceived`
  - `stockUnitCost = unitCost`
- Existing items keep working without purchase-unit configuration

## UI Changes

### Global rename

Every item-facing surface that means the canonical inventory unit should say "Stocking Unit" instead of "Unit":

- item form
- inventory lists and detail pages
- BOM editor headers
- manufacturing tables

Do not force this terminology onto historical PO snapshots where "Unit" may still read more naturally in context.

### Item form

Keep the interaction minimal:

1. **Stocking Unit** — required picker, existing field relabeled
2. **Purchase Unit** — optional picker directly below it
3. **Purchase conversion** — only shown when a purchase unit is selected

Behavior:

- Empty purchase unit means "purchased in stocking units"
- If purchase and stock units are same-measure, compute the factor immediately and show a small read-only helper line such as "1 Bag = 50 Pounds"
- If they are cross-measure, show a numeric input labeled `Stocking units per 1 purchase unit`
- Do not use an extra checkbox
- Do not reveal the factor field only on blur

### Purchase orders

When an item has a purchase unit:

- PO line quantity entry uses the purchase unit
- Line unit label shows the purchase unit
- Show a quiet secondary stocking equivalent, for example `10 Bags` with muted text `500 lb stocked`
- Unit cost entry is per purchase unit because that matches vendor documents
- On save, line totals use purchase quantity x purchase unit cost

When an item has no purchase unit:

- PO behavior is unchanged

### Receiving

- User enters received quantity in the purchase unit
- The detail view can show the stock equivalent as secondary text
- The system writes lots in stocking units and values them using stock-unit cost

### Inventory / BOM / Manufacturing

No workflow change. These stay entirely in stocking units.

Item detail may optionally show:

- Stocking Unit
- Purchase Unit
- Purchase conversion summary

## Conversion Logic

### Same-category auto-conversion

When purchase and stock units are compatible, derive the factor from the unit definitions:

```ts
import convert from "convert";

const purchaseToStockFactor =
  convert(Number(purchaseUnit.size), purchaseUnit.uom).to(stockingUnit.uom) /
  Number(stockingUnit.size);
```

### Cross-category manual conversion

When units are not compatible through `convert`:

- require `purchaseToStockFactor`
- validate it is a positive decimal

### Purchase-order snapshot derivation

When saving a draft PO line:

```ts
const purchaseQty = Number(line.quantityOrdered);
const purchaseUnitCost = Number(line.unitCost);
const factor = Number(item.purchaseToStockFactor ?? 1);

const stockQuantityOrdered = purchaseQty * factor;
const stockUnitCost = purchaseUnitCost / factor;
```

Persist both the purchase-side and stock-side values on the line snapshot.

### Receiving conversion

When a PO line is received:

```ts
const receivedPurchaseQty = Number(input.quantityReceived);
const stockReceivedQty = receivedPurchaseQty * Number(line.purchaseToStockFactor);

await createPositiveLotAndMovementInTx(tx, {
  quantity: stockReceivedQty,
  costPerUnit: line.stockUnitCost,
  movementType: "purchase_received",
  referenceType: "purchase_order",
  referenceId: id,
});
```

Update both:

- `quantityReceived` in purchase units
- `stockQuantityReceived` in stocking units

### Expected quantity

`items.expectedQty` must continue to mean stocking-unit inbound supply. Recompute it from:

```ts
SUM(purchase_order_lines.stock_quantity_ordered - purchase_order_lines.stock_quantity_received)
```

Never derive `expectedQty` from purchase-unit quantities after this change.

## Implementation Plan

### Phase 1: item configuration

- add purchase-unit fields to `items`
- update item Zod schemas
- update item form and detail queries/UI
- relabel canonical item unit surfaces to "Stocking Unit"

### Phase 2: purchasing snapshots

- extend PO line schema and backfill old rows
- update PO material option queries to include purchase-unit config
- save purchase-unit and stock-unit snapshots on PO lines
- update PO detail/edit types

### Phase 3: receiving and aggregates

- receive in purchase units
- create lots in stocking units with stock-unit cost
- recompute `expectedQty` from stock-unit snapshot columns

### Phase 4: tests

- item create/edit with purchase unit
- PO create/detail with purchase unit and stock equivalent
- partial receipt converts quantities correctly
- lot quantity and `costPerUnit` are written in stocking units
- `expectedQty` tracks remaining stock-equivalent quantity

## Out of Scope

- selling units
- customer-facing pricing by alternate item unit
- generalized conversion tables
- multi-level packaging hierarchies
- vendor-specific overrides per supplier
