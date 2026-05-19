---
read_when: planning follow-up work on the variant-first card UI or before dropping deprecated inventory columns
---

# Variant-first card UI cleanup

## Completed

- Product and material detail routes render item cards by default.
- The old `?view=card` gate and legacy item-detail components are removed.
- `/inventory/products/:id/variants/new`, `/api/items/:id/variants`, the legacy variant form, `getVariants()`, and legacy master/variant writers are removed.
- Paonia loader seeds normalized `item_families`, option/value rows, and concrete operational variants directly.
- Inventory, sales, manufacturing, planning, allocation, and ledger display paths use item families and normalized option values instead of fake-master fallback display.
- The old `formatVariantDisplay(masterName, attrs, axes)` and `resolveVariantDisplay()` helpers are removed.

## Still Live On Purpose

- `/inventory/products/new` and `/inventory/materials/new` use the item-card create shell and call `/api/item-cards`.
- `/inventory/products/:id/edit` and `/inventory/materials/:id/edit` still exist for legacy direct edit links and per-variant stock/cost/operation fields.
- `PUT /api/items/:id` remains as the per-variant stock/cost/operation write path until operations editing moves fully inline.

## Remaining Cleanup Gates

- Move Operations editing from `/inventory/products/:variantId/edit` into the card tab.
- Add Android-facing contract coverage for `familyId`, `displayName`, `optionValues`, and deleted variant display.
- Add the follow-up migration that drops deprecated fake-master columns after runtime and tests no longer reference them.

## Deprecated Columns

Drop only after the gates above are complete:

- `inventory.items.is_master`
- `inventory.items.parent_id`
- `inventory.items.variant_axes`
- `inventory.items.variant_attrs`
- legacy indexes and constraints that only support fake masters

## Verification

Use these greps before the drop-column migration:

```bash
rg "variantAxes|variantAttrs|parentId|isMaster|formatVariantDisplay|resolveVariantDisplay" app components lib scripts test
rg "item-form|/edit" app/\(dashboard\)/inventory docs
```
