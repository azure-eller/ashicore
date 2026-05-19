---
read_when:
  - Cleaning up the legacy inventory variant implementation
  - Removing deprecated item master routes, forms, helpers, or tests
---

# Item Card Cleanup Log

This is the transition checklist for removing the legacy fake-master variant
model after the item-card UI and mobile clients are migrated.

## Stabilization Gates

- UI uses `/api/item-cards/*` for product/material card create, edit, variant
  config, generation, deletion, and BOM copy.
- Product and material detail routes render item cards by default; the old
  `?view=card` gate has been removed.
- UI uses `PATCH /api/items/:variantId` only for variant-owned fields: SKU,
  prices, barcodes, supplier item code, lead time, MOQ, stock/cost, and BOM.
- All inventory, sales, purchasing, manufacturing, stocktake, planning, ledger,
  accounting, and Android pickers consume concrete item rows from `/api/items`
  and display `displayName`.
- Paonia loader creates package-first `item_families`, normalized options/values,
  and concrete operational variants for soil bag/tote products directly. It no
  longer seeds fake masters for those SKUs.
- Fast and slow inventory suites cover card create/update/delete, variant
  generation/promotion, duplicate-combination warnings, disabled historical
  values, BOM copy, and picker contracts.

## Deprecated Routes And Forms

Remove only after the stabilization gates are met.

- `/inventory/products/[id]/variants/new` removed.
- Legacy variant form components that write `variantAxes` or `variantAttrs`
  removed for the product variant create flow.
- Product create/edit form no longer exposes the fake-master toggle; direct
  edits of legacy master rows redirect to the detail page.
- Legacy `ItemDetail` fallback components removed after detail routes switched
  to card-first rendering.
- Legacy `createMasterProduct`, `updateMasterProduct`, `createVariant`, and
  test helper writes removed.
- Legacy `/api/items/:id/variants` route and `getVariants()` read helper removed.
- Legacy master/variant Zod schemas removed from `lib/schemas/items.ts`.
- Product/material edit controls that send family-owned fields through
  `/api/items/:id`
- Any route logic branching on `isMaster` for editable product identity

Grep targets:

```bash
rg "variants/new|variantAxes|variantAttrs|isMaster|parentId" app components lib test scripts
```

## Deprecated Columns

Drop in a follow-up migration only after all grep targets are gone from runtime
code, tests, and loaders:

- `inventory.items.is_master`
- `inventory.items.parent_id`
- `inventory.items.variant_axes`
- `inventory.items.variant_attrs`
- Legacy duplicated item-level family fields once all readers use
  `inventory.item_families`: `name`, `category`, `description`,
  `unit_definition_id`, `purchase_unit_definition_id`,
  `purchase_to_stock_factor`
- Package-sized legacy variants currently keep `items.unit_definition_id` as the
  operational unit during cutover because Paonia package options encode 1cf bag,
  2cf bag, tote, and bale units on concrete SKUs. Do not drop or mask item-level
  units until the product model has an explicit package/conversion contract.

Migration sequence:

1. Add runtime guards/tests proving no writes to deprecated columns.
2. Backfill any remaining display snapshots needed for historical records.
3. Drop legacy indexes/triggers that exist only for fake masters.
4. Drop deprecated columns in one migration generated from fresh `origin/main`.
5. Run `pnpm db:check-migrations`, Paonia reload, inventory fast/slow lanes, and
   Android contract checks.

## Helpers To Remove

- Legacy variant display helpers that format from `variantAxes`/`variantAttrs`
- Legacy master/child query branches in inventory list/detail reads
- Paonia soil bag/tote and nute-bag loader paths no longer create legacy fake
  masters; keep future loader seeds on normalized `item_families`.
- Tests whose assertions depend on fake master rows being visible or editable

## Android Contract Cleanup

- Confirm Android item list/detail calls continue to use concrete `items.id`.
- Add Android-facing contract coverage for `familyId`, `displayName`,
  `optionValues`, and deleted variant display.
- Remove any mobile assumptions that product/material identity equals one item
  row after the app is updated.

## Deferred Domain Migrations

- Purchasing should read material default supplier, purchase unit, and conversion
  from `item_families`.
- Sales/manufacturing/planning/stocktake/accounting exports should prefer
  `displayName` or normalized option metadata where currently showing raw
  `items.name`.
- BOM copy remains explicit per concrete product variant; do not introduce live
  family-level BOM inheritance.
