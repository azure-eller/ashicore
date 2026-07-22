---
read_when:
  - Building product or material card UI
  - Changing item card, variant, or inventory item REST contracts
---

# Item Card Backend Contract

Product/material cards live in `inventory.item_families`; operational variants live in
`inventory.items`. Public URLs and operational references continue to use concrete
`items.id` values.

## Operational Items

`GET /api/items` returns concrete, non-deleted operational items only. Rows include:

- `familyId`, `familyName`
- `optionCombinationKey`
- `optionValues`
- `displayName`
- `duplicateCombinationWarnings`
- `dispositionBalances` (positive default-location quantities grouped by disposition)

Legacy fake master rows are not returned.

## Card APIs

`:itemId` is always a concrete operational `items.id`.

- `GET /api/item-cards/:itemId`
- `POST /api/item-cards`
- `PATCH /api/item-cards/:itemId`
- `PUT /api/item-cards/:itemId/variant-config`
- `POST /api/item-cards/:itemId/variants/generate-preview`
- `POST /api/item-cards/:itemId/variants/generate`
- `POST /api/item-cards/:itemId/bom-copy`
- `GET /api/items/:itemId/bom-revisions`
- `POST /api/items/:itemId/bom-revisions`
- `DELETE /api/item-cards/:itemId`

Card reads return `focusedVariantId`, `family`, `options`, and `variants`.
Family fields include material-level `defaultSupplierId`, purchase unit, and
purchase-to-stock conversion. Variant rows include `sellable`,
SKU/barcode/default fields, option display, duplicate-combination warnings, and
deleted variants display with `(deleted)`. Products and materials both use the
variant-level `sellable` flag to control whether the item can appear on sales
orders. Each variant also includes `dispositionBalances`, aggregated at the
default location so clients can offer item-level quality actions without
exposing the hidden lot used by untracked stock.

`PATCH /api/item-cards/:itemId` updates family/card metadata only. Variant-owned
fields such as SKU, prices, barcodes, lead time, and MOQ stay on
`PATCH /api/items/:variantId`.

## Variants

The first generation after configuring options promotes the existing default
variant from `optionCombinationKey = ''` to the selected option assignment in the
same transaction before inserting new variants.

Duplicate option combinations are allowed. Responses expose duplicate warnings;
filled duplicate SKUs remain blocked by the database.

Variant config updates are incremental. Removed unused options/values are hard
deleted. Removed used options/values are disabled with `disabled_at` and remain
available for historical display.

Deleting a variant blocks the last active variant in a card. Unused variants are
hard-deleted with assignments; variants with historical references are
soft-deleted.

## BOM Copy

`POST /api/item-cards/:itemId/bom-copy` copies the current BOM from the focused
product variant to sibling product variants. It creates new BOM revisions for
targets and copies components, lot-age constraints, and operation costs. It does
not create shared family-level BOM inheritance.

## BOM Revisions

`POST /api/items/:itemId/bom-revisions` saves the product's recipe payload as an
append-only BOM revision. If the submitted recipe basis, output quantity,
components, constraints, and explicitly submitted operation costs match the
current revision, the route is an idempotent no-op: it returns the current
`revisionId` and `revisionNumber` with `created: false` instead of appending a
duplicate revision.
