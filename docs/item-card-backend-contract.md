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

`displayName` is the canonical operator-facing item identity everywhere the app
shows, searches, exports, or snapshots an item. It is the family name (or the
standalone item name) followed by every assigned option value in option order,
separated by ` / `. The raw `name` field is editable base data and must not be
used as a presentation fallback for a variant.

## Card APIs

`:itemId` is always a concrete operational `items.id`.

- `GET /api/item-cards/:itemId`
- `POST /api/item-cards`
- `PATCH /api/item-cards/:itemId`
- `PUT /api/item-cards/:itemId/variant-config`
- `POST /api/item-cards/:itemId/variants/generate-preview`
- `POST /api/item-cards/:itemId/variants/generate`
- `POST /api/item-cards/:itemId/bom-copy`
- `GET /api/items/:itemId/estimated-unit-cost`
- `GET /api/items/:itemId/recipe-tab`
- `GET /api/items/:itemId/bom-revisions`
- `POST /api/items/:itemId/bom-revisions`
- `DELETE /api/item-cards/:itemId`

Card reads return `focusedVariantId`, `family`, `options`, and `variants`.
Family fields include material-level `defaultSupplierId`, purchase unit and
purchase-to-stock conversion, plus the optional sales unit and sales-to-stock
conversion shared by products and materials. Variant rows include `sellable`,
SKU/barcode/default fields, option display, duplicate-combination warnings, and
deleted variants display with `(deleted)`. Products and materials both use the
variant-level `sellable` flag to control whether the item can appear on sales
orders. Each variant also includes `dispositionBalances`, aggregated at the
default location so clients can offer item-level quality actions without
exposing the hidden lot used by untracked stock.

`PATCH /api/item-cards/:itemId` updates family/card metadata only. Variant-owned
fields such as SKU, prices, barcodes, lead time, and MOQ stay on
`PATCH /api/items/:variantId`.

Variant option-assignment maps accept canonical PostgreSQL UUID strings. This
includes deterministic option and value IDs created by migration `0107`, even
when their version or variant bits do not match an RFC UUID version.

## Alternate Unit Rules

The stocking unit remains the canonical inventory, manufacturing, planning,
lot, and cost basis. Purchase and sales units are independent optional
family-level presentation/transaction bases:

- each alternate unit id and factor is an all-or-nothing pair
- each factor is positive and means stocking units per one alternate unit
- sales-to-stock factors persist at four decimal places and must round into the
  inclusive `0.0001` to `99,999,999.9999` range
- choosing the stocking unit as an alternate canonicalizes that alternate pair
  to null
- compatible unit definitions derive conversions automatically; incompatible
  pairs require an explicit factor
- changing the stocking unit re-derives both compatible alternate factors in
  the domain layer, not only in the browser. An incompatible change without a
  replacement factor fails rather than preserving a stale denominator.

Sales-unit controls are shown when at least one active variant is sellable.
`defaultSellingPrice` is per effective sales unit. A factor change rescales
non-null default selling prices for all family variants in the same transaction
to preserve value per stocking quantity; historical sales-order snapshots do
not change.

## Variants

The first generation after configuring options promotes the existing default
variant from `optionCombinationKey = ''` to the selected option assignment in the
same transaction before inserting new variants.

Duplicate option combinations are allowed. Responses expose duplicate warnings;
filled duplicate SKUs remain blocked by the database.

Variant config updates are incremental. Removed unused options/values are hard
deleted. Removed used options/values are disabled with `disabled_at` and remain
available for historical display. Because those assignments remain part of the
variant's identity, disabled option values remain in `displayName`.

Adding an option does not rewrite existing variants. Existing variants may keep
a partial option assignment and display only the values they have; operators can
fill the new option later or retire the older variant. Newly created and generated
variants still require one value for every active option. An existing variant's
assignment may be partial but not empty.

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

## Recipe Tab Read Model

`GET /api/items/:itemId/recipe-tab` returns the focused product's current BOM
rows and revision metadata. When the member may view the BOM, component options
already used by the current recipe include `estimatedUnitCost`, resolved from
the same current estimated-cost graph used by item cards. The client reads a
newly selected component's current rate from
`GET /api/items/:itemId/estimated-unit-cost` rather than resolving every
available catalog item when the tab opens. That endpoint returns
`{ estimatedUnitCost: string | null }` for any existing item visible to an
inventory operator, or `404` when the item does not exist. `null` means the
current estimate cannot be resolved. The recipe-tab response also includes
`hasOperationCosts`, which lets the client distinguish a recipe with no
operations from one whose current operation estimate is unresolved.

The client combines those component rates with draft quantities through the
canonical recipe-basis normalization helper. It displays only each row's
estimated contribution per finished output unit, not the underlying component
rate. This is a current estimate only: BOM revision history does not expose
historical component-cost snapshots.
