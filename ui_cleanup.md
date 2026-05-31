# UI Cleanup Audit

This is an evidence log of repeated bespoke UI patterns found by static scans of
`app/` and `components/`. It does not propose fixing these in place; each section
names the shared component or pattern that should exist, lists current
implementations, and recommends a likely foundation when one is obvious.

Reference rules used while auditing:

- `docs/reusable-components.md`
- `docs/ui-patterns.md`
- `docs/design-system/01_DESIGN_SYSTEM.md`

Searches used included AG Grid renderers/editors, shadcn table/select/dropdown/
popover/tooltip/badge imports, direct layout sizing (`max-w-*`, `p-4`, `gap-4`,
`rounded-*`), date/currency formatting, local combobox usage, form/error
composition, loading states, search controls, charts, progress/timeline visuals,
browser-native confirms/alerts, print actions, option controls, picker dialogs,
notice/error surfaces, access badges, inline style exceptions, and
file/clipboard interactions, bulk-selection flows, row reorder/priority
controls, persisted view preferences, and keyboard shortcut affordances.

## 1. Dashboard Module Layout Shell

**Proposed shared component:** `DashboardModuleShell` or `ModuleLayoutShell`.

**Pattern:** Sales, manufacturing, purchasing, and inventory layouts all hand-roll
page padding and vertical gaps. Settings uses a slightly different padding and a
two-column nav layout. This keeps page density and gutters inconsistent with the
V2 page-padding rule.

**Current places:**

- `app/(dashboard)/sales/layout.tsx`
- `app/(dashboard)/manufacturing/layout.tsx`
- `app/(dashboard)/inventory/layout.tsx`
- `app/(dashboard)/purchasing/layout.tsx`
- `app/(dashboard)/settings/layout.tsx`
- `app/(dashboard)/sales/demand-queue-coverage-table.tsx` also creates its own page body with `p-(--space-8)`.
- `app/(dashboard)/sales/pricing/schedules/[id]/edit/page.tsx` wraps the form in `mx-auto w-full max-w-5xl py-8` instead of the create-page shell.
- `app/(dashboard)/inventory/products/[id]/bom-history/page.tsx` uses `mx-auto w-full max-w-6xl p-6`.

**Recommendation:** Base this on `CreatePageShell` for create/edit surfaces and a
new dense dashboard shell for list/workflow pages. The module layouts should own
the standard gutter instead of each page.

## 2. Detail Page Header / Actions

**Proposed shared component:** extend `CardPageHeader` / `DetailPageActions`
instead of local header/action rows.

**Pattern:** Detail and history pages build local back links, H1/meta rows, badges,
right-side actions, save status, print/close/menu actions, and destructive menu
ordering. `CardPageHeader` already centralizes this for card pages, but several
surfaces still build their own version.

**Current places:**

- Shared foundation: `components/card-page/card-page-header.tsx`
- Shared compact action foundation: `components/detail-page-actions.tsx`
- Bespoke history header/back link: `app/(dashboard)/inventory/products/[id]/bom-history/page.tsx`
- Bespoke settings card/action rows: `app/(dashboard)/settings/integrations-section.tsx`
- Bespoke reports header/action rows: `app/(dashboard)/settings/reports-section.tsx`
- Bespoke agent access action rows: `app/(dashboard)/settings/agent-access-section.tsx`
- Bespoke accounting sync panels/actions: `components/accounting-sync-status.tsx`

**Recommendation:** Use `CardPageHeader` as the visual foundation. If settings
needs a non-card version, extract the common identity/action cluster rather than
continuing local flex rows.

## 3. Section Card / Panel Surface

**Proposed shared component:** `SettingsSection`, `WorkflowPanel`, or a stricter
extension of `CreateSection`.

**Pattern:** Many pages construct bordered panels with ad hoc padding, rounded
classes, muted headers, empty states, and metric boxes. These overlap with
`CreateSection`, `CreateSidebarCard`, and shadcn `Card`, but are not standardized.

**Current places:**

- Shared foundations: `components/create-page.tsx`, `components/ui/card.tsx`
- `app/(dashboard)/settings/reports-section.tsx` (`SummaryMetric`, `ReportTable`, rounded bordered panels)
- `app/(dashboard)/settings/integrations-section.tsx`
- `app/(dashboard)/settings/integrations/xero-import-section.tsx`
- `app/(dashboard)/settings/agent-access-section.tsx`
- `components/accounting-sync-status.tsx`
- `app/(dashboard)/sales/demand-queue-coverage-table.tsx`
- `app/(dashboard)/inventory/item-commitment-summary-card.tsx`
- `app/(dashboard)/inventory/item-history-sparkline-card.tsx`
- `components/manufacturing/ingredient-lot-card.tsx`

**Recommendation:** Start from `CreateSection` for form-like sections and create a
dense `Panel` primitive for read-only workflow/status sections. This should remove
local `rounded-md border p-*` panel styling.

## 4. Read-Only Operational Tables

**Proposed shared component:** `ERPReadOnlyTable` or migrate qualifying surfaces
to `ERPDataGrid`/`ERPDataGridList`.

**Pattern:** The repo rule says AG Grid is the default ERP table. Several
operational tables still use shadcn `Table`, each with local wrappers, numeric
alignment, empty rows, overflow, and borders.

**Current places:**

- `components/manufacturing/ingredient-lot-card.tsx`
- `components/card-page/order-status-configs.tsx`
- `app/(dashboard)/sales/demand-queue-coverage-table.tsx`
- `app/(dashboard)/sales/create-manufacturing-orders-dialog.tsx`
- `app/(dashboard)/sales/orders/[id]/plan-shipment-dialog.tsx`
- `app/(dashboard)/settings/reports-section.tsx`
- `app/(dashboard)/settings/integrations/xero-import-section.tsx`
- `app/(dashboard)/inventory/products/[id]/bom-history/page.tsx`

**Recommendation:** Use AG Grid for list-like operational data with resizing,
dense rows, and repeated numeric columns. For small dialog summaries that should
remain semantic tables, create `ERPReadOnlyTable` with standard header, numeric
cell, empty state, border, and overflow behavior.

## 5. AG Grid Link / Identity Cells

**Proposed shared component:** `GridEntityLinkCell`.

**Pattern:** Entity columns repeatedly render a link with `hover:underline`,
optional mono styling, truncation, secondary text, and quick-filter text. The
visual treatment differs by route.

**Current places:**

- `app/(dashboard)/sales/orders-table.tsx`
- `app/(dashboard)/manufacturing/orders-table.tsx`
- `app/(dashboard)/sales/customers-table.tsx`
- `app/(dashboard)/purchasing/orders-table.tsx`
- `app/(dashboard)/purchasing/suppliers-table.tsx`
- `app/(dashboard)/inventory/stocktakes/stocktakes-table.tsx`
- `app/(dashboard)/inventory/ledger/ledger-table.tsx`
- `app/(dashboard)/inventory/columns.tsx`
- `app/(dashboard)/sales/customer-card.tsx`
- `app/(dashboard)/sales/orders/[id]/line-items-table.tsx`
- `app/(dashboard)/sales/orders/[id]/shipments-table.tsx`
- `app/(dashboard)/manufacturing/orders/[id]/manufacturing-order-card.tsx`
- `app/(dashboard)/purchasing/purchase-order-card.tsx`

**Recommendation:** Put the common cell in the grid toolbox with props for `href`,
`label`, `secondary`, `mono`, and `muted`. Prefer this over local `cellRenderer`
link spans.

## 6. AG Grid Date / Number / Money Columns

**Proposed shared helpers:** `dateColumn`, `dateTimeColumn`, `quantityColumn`,
`moneyColumn`, `monoTextColumn`.

**Pattern:** Column definitions repeatedly choose width/minWidth, `cellClass:
"mono"` or `"num"`, `valueFormatter`, and comparator logic. Some date/time cells
use `DateTimeText`, others use `formatDate`, `formatDateTime`, or
`toLocaleDateString`.

**Current places:**

- `app/(dashboard)/sales/orders-table.tsx`
- `app/(dashboard)/manufacturing/orders-table.tsx`
- `app/(dashboard)/purchasing/orders-table.tsx`
- `app/(dashboard)/inventory/ledger/ledger-table.tsx`
- `app/(dashboard)/inventory/stocktakes/stocktakes-table.tsx`
- `app/(dashboard)/sales/pricing-schedules-table.tsx`
- `app/(dashboard)/purchasing/suppliers-table.tsx`
- `app/(dashboard)/settings/reports-section.tsx`
- `app/(dashboard)/settings/integrations-section.tsx`
- `app/(dashboard)/inventory/products/[id]/bom-history/page.tsx`
- `app/(dashboard)/sales/orders/[id]/totals-strip.tsx` has local `formatMoney`.

**Recommendation:** Foundation should live beside `ERPDataGrid` and use
`lib/format.ts` plus `DateTimeText`. This would make mono/tabular classes and
date-only vs timestamp handling consistent.

## 7. Status Labels / Badges

**Proposed shared component:** `EntityStatusLabel` plus domain status metadata.

**Pattern:** Domain status badges repeat the same `StatusLabel + Tooltip`
structure. Other status-like labels still use raw `Badge`, which conflicts with
the status rule that status should be label + square indicator, not rounded pills.

**Current places using `StatusLabel` wrappers:**

- `app/(dashboard)/sales/status-badge.tsx`
- `app/(dashboard)/manufacturing/status-badge.tsx`
- `app/(dashboard)/purchasing/status-badge.tsx`
- `app/(dashboard)/inventory/stocktakes/status-badge.tsx`
- `app/(dashboard)/manufacturing/pick-progress-badge.tsx`
- `app/(dashboard)/sales/orders/[id]/shipments-table.tsx`
- `app/(dashboard)/sales/customer-card.tsx` project status labels

**Current places using raw `Badge` for status/tag display:**

- `app/(dashboard)/settings/team-section.tsx`
- `app/(dashboard)/settings/team-role-badge.tsx`
- `app/(dashboard)/settings/reports-section.tsx`
- `app/(dashboard)/settings/integrations-section.tsx`
- `app/(dashboard)/settings/agent-access-section.tsx`
- `app/(dashboard)/settings/integrations/xero-import-section.tsx`
- `app/(dashboard)/inventory/columns.tsx`
- `app/(dashboard)/inventory/lot-grid-tab.tsx`
- `app/(dashboard)/inventory/item-commitment-summary-card.tsx`
- `app/(dashboard)/inventory/products/[id]/bom-history/page.tsx`
- `app/(dashboard)/sales/pricing-schedule-form.tsx`
- `app/(dashboard)/sales/create-manufacturing-orders-dialog.tsx`
- `app/(dashboard)/purchasing/purchase-order-card.tsx`
- `components/accounting-sync-status.tsx`
- `components/inventory-item-combobox.tsx`
- `components/quantity-with-unit.tsx`

**Recommendation:** Use `StatusLabel` as the foundation for true status. Keep
`Badge` only for non-status metadata after deciding whether tags/chips need their
own sharp `Tag` component.

## 8. Status Block Cells / Actionable Fulfillment Cells

**Proposed shared component:** `FulfillmentStatusBlockCell` and
`StatusBlockDropdown`.

**Pattern:** Sales and manufacturing list pages map domain fulfillment tones to
`StatusBlockTone`, render a full-height `StatusBlock`, and often attach a
dropdown containing the same mini coverage table layout.

**Current places:**

- `app/(dashboard)/sales/orders-table.tsx`
- `app/(dashboard)/manufacturing/orders-table.tsx`
- `app/(dashboard)/sales/sales-order-table-action-cells.tsx`
- `app/(dashboard)/sales/orders/[id]/line-items-table.tsx`
- `components/card-page/order-status-control.tsx`

**Recommendation:** Use `StatusBlock` as foundation. Extract the tone map and
dropdown trigger conventions so sales/manufacturing do not each define local
tone maps and menu tables.

## 9. Dropdown Mini Tables / Coverage Popovers

**Proposed shared component:** `CompactMetricDropdownTable`.

**Pattern:** Multiple status menus render a small, scrollable grid with item name
and right-aligned quantities. Column widths, empty messages, danger coloring, and
header text are local.

**Current places:**

- `app/(dashboard)/sales/orders-table.tsx` (`DetailMenuTable`, ingredients/items status menus)
- `app/(dashboard)/manufacturing/orders-table.tsx` (`IngredientsStatusCell`)
- `app/(dashboard)/sales/sales-order-table-action-cells.tsx`
- `app/(dashboard)/sales/orders/[id]/line-items-table.tsx` fulfillment/status cells
- `components/card-page/order-status-configs.tsx`

**Recommendation:** Base this on the sales `DetailMenuTable`; it already handles
optional expected quantity and empty states. Move it to a shared component and
let callers pass columns/rows rather than raw grid templates.

## 10. Notes / Long Text Tooltip Cell

**Proposed shared component:** `GridTooltipTextCell`.

**Pattern:** Notes and long text cells render truncated muted text with tooltip
content. Some use `TooltipHeader`, some local `Tooltip`, some plain links/spans.

**Current places:**

- `app/(dashboard)/sales/orders-table.tsx` (`NotesCell`)
- `app/(dashboard)/inventory/columns.tsx`
- `app/(dashboard)/inventory/ledger/ledger-table.tsx`
- `app/(dashboard)/sales/sales-allocation-table.tsx`
- `components/tooltip-header.tsx`
- `components/sortable-header.tsx`
- `components/filterable-header.tsx`

**Recommendation:** Keep `TooltipHeader` for headers. Add a grid/body tooltip
cell for truncated text and use the default tooltip styling without page-local
`max-w-*` and whitespace classes.

## 11. Filter Header / Toolbar Controls

**Proposed shared components:** `GridFilterHeader`, `GridToolbarFilter`,
`ActiveFilterBadges`.

**Pattern:** Several tables build local filter dropdowns, active badges, clear
buttons, result counts, and rows-per-page selects instead of using
`ERPDataGridList` or a shared filter toolbar.

**Current places:**

- Shared foundations: `components/filterable-header.tsx`, `components/sortable-header.tsx`, `components/data-table-status-filter.tsx`
- `app/(dashboard)/inventory/ledger/ledger-table.tsx`
- `app/(dashboard)/sales/orders-table.tsx`
- `app/(dashboard)/manufacturing/orders-table.tsx`
- `app/(dashboard)/inventory/stocktakes/stocktakes-table.tsx`
- `components/erp-data-grid-list.tsx`

**Recommendation:** Preserve `ERPDataGridList` as the list-page foundation, but
promote the ledger’s date/status/multi-select filter patterns into shared grid
toolbar primitives.

## 12. Editable Line Field Types

**Proposed shared line field additions:** account-code combobox, status-select,
quantity-with-cap, shipment-cost type, order project/job selector.

**Pattern:** The named line wrappers are in use, but several line-like workflows
still need page-local field/render logic because the shared `LineField` kinds do
not cover their domain controls.

**Current places using shared wrappers but with specialized local fields:**

- `app/(dashboard)/inventory/bom-editor.tsx`
- `components/card-page/operation-cost-editor.tsx`
- `app/(dashboard)/settings/tax-rates-section.tsx`
- `app/(dashboard)/sales/pricing-schedule-form.tsx`
- `app/(dashboard)/manufacturing/orders/[id]/manufacturing-order-card.tsx`
- `app/(dashboard)/sales/customer-card.tsx`
- `app/(dashboard)/sales/orders/[id]/shipments-table.tsx`
- `app/(dashboard)/sales/orders/[id]/line-items-table.tsx`
- `app/(dashboard)/purchasing/purchase-order-card.tsx`

**Current direct `EditableLineDataGrid` custom workflows:**

- `components/card-page/variant-table.tsx`
- `app/(dashboard)/inventory/stocktakes/stocktake-detail.tsx`

**Recommendation:** Keep direct use for true custom workflow grids such as
variants/stocktakes. For repeated business-line fields, add field kinds to
`components/editable-lines.tsx` before more pages define custom renderers.

## 13. Address Comboboxes

**Proposed shared component:** one canonical `AddressBookCombobox`.

**Pattern:** There is already `components/delivery-address-input.tsx`, but
customer, supplier, and purchase order cards duplicate the same combobox item
sentinels (`add`, `edit`, `same as shipping`), 28rem popup width, option maps,
secondary address lines, separators, and clear behavior.

**Current places:**

- Shared-ish foundation: `components/delivery-address-input.tsx`
- `app/(dashboard)/sales/customer-card.tsx`
- `app/(dashboard)/purchasing/supplier-card.tsx`
- `app/(dashboard)/purchasing/purchase-order-card.tsx`

**Recommendation:** Use `components/delivery-address-input.tsx` as the foundation,
but broaden it into a generic address-book combobox with optional null/same-as,
add/edit sentinels, read-only display, and caller-provided secondary text.

## 14. Generic Entity Comboboxes

**Proposed shared component:** extend `EntityCombobox` with common width, create
links, secondary text, empty state, and clear behavior options.

**Pattern:** `EntityCombobox` and `InventoryItemCombobox` exist, but account,
category, project/job, supplier, and address-like selectors are implemented with
different components or direct `Select`.

**Current places:**

- Shared foundations: `components/entity-combobox.tsx`, `components/inventory-item-combobox.tsx`, `components/combobox-create-links.tsx`, `components/card-page/category-combobox-field.tsx`
- Supplier selector: `app/(dashboard)/purchasing/supplier-select.tsx`
- Material supplier selector: `app/(dashboard)/inventory/materials/[id]/tabs/supply-details.tsx`
- Sales order customer selector: `app/(dashboard)/sales/orders/[id]/order-details-grid.tsx`
- Purchase order Xero account combobox: `app/(dashboard)/purchasing/purchase-order-card.tsx`
- Category selector: `components/card-page/category-combobox-field.tsx`
- Address selectors listed in section 13

**Recommendation:** Keep `EntityCombobox` as the base, but add standardized option
slots and popup width defaults so callers do not have to compose raw Base UI
combobox parts for common entity searches.

## 15. Select Fields

**Proposed shared component:** `FormSelectField` / `InlineSelectField`.

**Pattern:** Page code repeatedly wires `Select`, `SelectTrigger`,
`SelectContent`, labels, `aria-invalid`, width classes, and option maps. Some are
form fields, some are inline card fields, and some are status controls.

**Current places:**

- `components/manufacturing/manufacturing-completion-dialog.tsx`
- `components/card-page/variant-configuration-dialog.tsx`
- `components/card-page/operation-cost-editor.tsx`
- `components/card-page/active-variant-select.tsx`
- `app/(dashboard)/settings/team-section.tsx`
- `app/(dashboard)/settings/tax-rates-section.tsx`
- `app/(dashboard)/settings/integrations-section.tsx`
- `app/(dashboard)/manufacturing/resources/resources-client.tsx`
- `app/(dashboard)/manufacturing/orders/[id]/manufacturing-order-card.tsx`
- `app/(dashboard)/manufacturing/orders-table.tsx`
- `app/(dashboard)/inventory/products/[id]/tabs/general-info.tsx`
- `app/(dashboard)/inventory/materials/[id]/tabs/general-info.tsx`
- `app/(dashboard)/inventory/materials/[id]/tabs/supply-details.tsx`
- `app/(dashboard)/sales/customer-card.tsx`
- `app/(dashboard)/sales/pricing-schedule-form.tsx`
- `app/(dashboard)/sales/orders/[id]/order-details-grid.tsx`
- `app/(dashboard)/sales/orders/[id]/shipment-costs-dialog.tsx`
- `app/(dashboard)/sales/orders/[id]/plan-shipment-dialog.tsx`
- `app/(dashboard)/purchasing/status-badge.tsx`

**Recommendation:** Extract form-bound and inline variants. `purchasing/status-
badge.tsx` should likely move to a separate shared `StatusSelect` pattern instead
of mixing status display and mutation confirmation in one badge component.

## 16. Dropdown Action Menus

**Proposed shared component:** `ActionMenu` and `GridRowActionMenu`.

**Pattern:** Multiple components create a three-dot/menu button, align content,
order destructive actions last, handle disabled tooltips, and stop propagation in
grid cells.

**Current places:**

- Shared-ish foundations: `components/detail-page-actions.tsx`, `components/card-page/card-page-header.tsx`, `components/erp-data-grid-list.tsx`
- `app/(dashboard)/settings/integrations-section.tsx`
- `app/(dashboard)/inventory/stocktakes/stocktakes-table.tsx`
- `app/(dashboard)/inventory/lot-disposition-actions.tsx`
- `app/(dashboard)/sales/sales-order-table-action-cells.tsx`
- `app/(dashboard)/sales/sales-allocation-table.tsx`
- `app/(dashboard)/sales/orders-table.tsx`
- `app/(dashboard)/manufacturing/orders-table.tsx`
- `app/(dashboard)/inventory/ledger/ledger-table.tsx`
- `app/(dashboard)/sales/orders/[id]/shipments-table.tsx`

**Recommendation:** Base this on `DetailPageActions` for detail pages and
`ERPDataGridList` for bulk/list actions. Add a row-menu variant with standardized
icon button sizing, alignment, propagation handling, and destructive ordering.

## 17. Empty / Loading / Error States

**Proposed shared components:** `InlineEmptyState`, `PanelEmptyState`,
`InlineErrorState`, `TableEmptyRow`.

**Pattern:** Empty and loading states are local strings in arbitrary wrappers:
bordered card blocks, table rows, dialog body messages, and inline muted divs.

**Current places:**

- `components/manufacturing/ingredient-lot-card.tsx`
- `app/(dashboard)/sales/demand-queue-coverage-table.tsx`
- `app/(dashboard)/sales/create-manufacturing-orders-dialog.tsx`
- `app/(dashboard)/sales/orders/[id]/plan-shipment-dialog.tsx`
- `app/(dashboard)/settings/reports-section.tsx`
- `app/(dashboard)/settings/integrations/xero-import-section.tsx`
- `app/(dashboard)/inventory/stocktakes/stocktake-detail.tsx`
- `components/accounting-sync-status.tsx`
- `components/erp-data-grid-list.tsx`
- `components/data-table-loading.tsx`
- `components/dashboard-route-loading.tsx`

**Recommendation:** Keep skeletons for full page/data loading. For small
surfaces, create constrained empty/error components with standard density and
destructive text behavior.

## 18. Inline Numeric Input Cells

**Proposed shared component:** `QuantityInputCell` / `NumericCellInput`.

**Pattern:** Numeric inputs inside tables and grids repeat right alignment,
decimal input mode, min/max/step, over-cap messaging, and font-mono/tabular
treatment.

**Current places:**

- `components/manufacturing/ingredient-lot-card.tsx`
- `app/(dashboard)/sales/orders/[id]/plan-shipment-dialog.tsx`
- `components/card-page/order-status-configs.tsx`
- `app/(dashboard)/inventory/lot-quantity-adjuster.tsx`
- `app/(dashboard)/sales/orders/[id]/shipping-fee-section.tsx`
- `app/(dashboard)/sales/orders/[id]/shipment-costs-dialog.tsx`
- `components/create-page.tsx` (`AffixedInput` handles some cases)
- `components/editable-lines.tsx` (`TextLineCellEditor` handles grid cases)

**Recommendation:** Reuse `TextLineCellEditor` for AG Grid line editing. For
semantic tables/dialogs, extract a small numeric input cell with cap/error slots.

## 19. Totals / Summary Rows / Metric Blocks

**Proposed shared components:** `SummaryRows`, `TotalsStrip`, `MetricGrid`.

**Pattern:** Several pages render label/value rows and metric boxes with local
font weights, mono classes, borders, and grid layouts. `SummaryRows` exists in
`components/create-page.tsx`, but usage is not broad enough.

**Current places:**

- Shared foundation: `components/create-page.tsx` (`SummaryRows`)
- `app/(dashboard)/sales/orders/[id]/totals-strip.tsx`
- `app/(dashboard)/sales/orders/[id]/shipping-fee-section.tsx`
- `app/(dashboard)/settings/reports-section.tsx` (`SummaryMetric`)
- `app/(dashboard)/inventory/item-commitment-summary-card.tsx`
- `app/(dashboard)/inventory/inventory-commitment-donut.tsx`
- `app/(dashboard)/inventory/item-history-sparkline-card.tsx`
- `components/accounting-sync-status.tsx`
- `app/(dashboard)/purchasing/purchase-order-card.tsx`
- `app/(dashboard)/sales/customer-card.tsx`

**Recommendation:** Promote `SummaryRows` out of create-page-specific naming, and
standardize a dense metric block that uses V2 text/spacing tokens.

## 20. Raw CSS Modules For Card/Workflow Styling

**Proposed shared approach:** migrate recurring classes into component primitives
or colocated components with tokenized Tailwind.

**Pattern:** CSS modules contain large bespoke style systems for card pages and
workflow grids. Some are legitimate complex surfaces, but they also hide page
spacing, colors, fallbacks, and repeated controls from normal component reuse.

**Current CSS modules:**

- `components/card-page/card-page.module.css`
- `components/erp-data-grid.module.css`
- `app/(dashboard)/sales/orders/[id]/order-card.module.css`
- `app/(dashboard)/sales/sales-allocation-table.module.css`
- `app/(dashboard)/sales/sales-order-allocator.module.css`

**Recommendation:** Keep `erp-data-grid.module.css` as a shared grid theme.
Treat `card-page.module.css` as a source for shared card-page primitives. Audit
the sales allocation/order CSS modules separately because they are likely hiding
several more reusable allocation-grid and inline-card controls.

## 21. Rounded / Shadow / Hardcoded Color Drift

**Proposed shared action:** remove local shape/color decisions in favor of tokens
and primitives.

**Pattern:** The design system says sharp corners, semantic colors, and minimal
shadow. Static scans still find local `rounded-md`, `rounded-lg`, `shadow-*`, and
hardcoded color fallbacks in non-avatar/non-dot UI.

**Current places to review first:**

- `components/inventory-visuals/*` uses rounded visual tokens and shadows for item tokens/demos.
- `components/accounting-sync-status.tsx` uses rounded bordered panels.
- `app/(dashboard)/settings/reports-section.tsx` uses rounded bordered tables/panels.
- `app/(dashboard)/settings/integrations/xero-import-section.tsx` uses rounded bordered panels.
- `app/(dashboard)/sales/create-manufacturing-orders-dialog.tsx` uses rounded bordered empty/table wrappers.
- `app/(dashboard)/sales/orders/[id]/plan-shipment-dialog.tsx` uses rounded table wrapper.
- `app/(dashboard)/inventory/products/[id]/bom-history/page.tsx` uses raw text sizes and badges.
- `components/card-page/card-page.module.css` contains hardcoded fallback colors and non-token border colors.
- `components/ui/chart.tsx`, `components/ui/sidebar.tsx`, and generated shadcn primitives still contain rounded/shadow defaults that may need token review.

**Recommendation:** Do not blindly replace every rounded class; avatars/dots and
some visual sprites may be intentional. Standardize panels/tables/action wrappers
first, then review remaining visual exceptions one by one.

## 22. Inventory Visual Components

**Proposed shared decision:** either bless `components/inventory-visuals/*` as a
separate visual system or constrain it to the main design tokens.

**Pattern:** The inventory visual components intentionally use custom sprite
colors, rounded item tokens, shadows, and demo-only grid panels. They are shared,
but they diverge from the ERP design system and may encourage more bespoke visual
treatments.

**Current places:**

- `components/inventory-visuals/item-token.tsx`
- `components/inventory-visuals/item-token-stack.tsx`
- `components/inventory-visuals/item-sprite.tsx`
- `components/inventory-visuals/legend.tsx`
- `components/inventory-visuals/demo.tsx`

**Recommendation:** Decide explicitly whether this is an approved exception. If
approved, document its boundaries. If not, refactor the token/stack components
toward sharp containers and semantic colors.

## 23. Accounting / Xero Sync UI

**Proposed shared components:** `IntegrationStatusPanel`, `SyncEventTimeline`,
`ExternalSystemBadge`, `SyncActionRow`.

**Pattern:** Accounting/Xero surfaces contain many local panels, status badges,
event rows, action rows, timestamps, and retry/undo controls. Some are in a shared
component already, but not generalized for settings/import pages.

**Current places:**

- `components/accounting-sync-status.tsx`
- `app/(dashboard)/settings/integrations-section.tsx`
- `app/(dashboard)/settings/integrations/xero-import-section.tsx`
- `app/(dashboard)/purchasing/purchase-order-card.tsx`
- `app/(dashboard)/sales/orders/[id]/order-card.tsx`
- `app/(dashboard)/sales/orders/[id]/shipments-table.tsx`

**Recommendation:** Use `components/accounting-sync-status.tsx` as the starting
point for data contracts and action states, but split visual primitives out so
settings and order cards do not each build local sync rows.

## 24. Dialog Form Layouts

**Proposed shared component:** `DialogFormBody` / `DialogSection` / standard
dialog footer actions.

**Pattern:** Dialogs frequently repeat field stacks, description text, table
wrappers, cancel/save buttons, and alert/error placement.

**Current places:**

- `components/manufacturing/manufacturing-completion-dialog.tsx`
- `components/card-page/variant-configuration-dialog.tsx`
- `components/card-page/order-status-configs.tsx`
- `components/card-page/operation-cost-editor.tsx`
- `components/card-page/copy-bom-dialog.tsx`
- `app/(dashboard)/settings/team-section.tsx`
- `app/(dashboard)/settings/account/*.tsx`
- `app/(dashboard)/settings/integrations-section.tsx`
- `app/(dashboard)/inventory/stocktakes/create-stocktake-dialog.tsx`
- `app/(dashboard)/sales/create-manufacturing-orders-dialog.tsx`
- `app/(dashboard)/sales/orders/[id]/*dialog*.tsx`
- `app/(dashboard)/inventory/lot-disposition-actions.tsx`

**Recommendation:** Create a light dialog form layout that standardizes body
spacing and footer actions without hiding domain-specific content.

## 25. Underline / Inline Editable Card Controls

**Proposed shared component:** `InlineFieldControl`.

**Pattern:** Card pages use inline/underline inputs and selects for editable
detail fields. The styling is currently mixed between CSS modules and ad hoc
class helpers.

**Current places:**

- `app/(dashboard)/sales/customer-card.tsx`
- `app/(dashboard)/purchasing/supplier-card.tsx`
- `app/(dashboard)/purchasing/purchase-order-card.tsx`
- `app/(dashboard)/sales/orders/[id]/order-details-grid.tsx`
- `app/(dashboard)/manufacturing/orders/[id]/manufacturing-order-card.tsx`
- `app/(dashboard)/inventory/products/[id]/tabs/general-info.tsx`
- `app/(dashboard)/inventory/materials/[id]/tabs/general-info.tsx`
- `app/(dashboard)/inventory/materials/[id]/tabs/supply-details.tsx`
- `components/card-page/form-cell.tsx`
- `components/card-page/card-page.module.css`

**Recommendation:** Use `components/card-page/form-cell.tsx` and
`card-page.module.css` as the foundation, but expose explicit input/select/
combobox wrappers so pages do not hand-apply underline classes.

## 26. Button And Link Action Types

**Proposed shared components:** `PrimaryCreateAction`, `SecondaryFormAction`,
`IconActionButton`, `InlineTextAction`, `DisabledActionTooltip`.

**Pattern:** The base `Button` exists, but pages still make local decisions about
which variant/size represents create actions, cancel actions, full-width connect
actions, icon-only menus, inline table links, and disabled buttons with tooltips.
Some action links are plain `Link` with `hover:underline`; others are `Button
asChild`.

**Current places:**

- Shared foundations: `components/ui/button.tsx`, `components/disabled-tooltip-button.tsx`, `components/detail-page-actions.tsx`, `components/card-page/card-page-header.tsx`
- List create actions: `components/erp-data-grid-list.tsx`, `app/(dashboard)/sales/orders-table.tsx`, `app/(dashboard)/manufacturing/orders-table.tsx`
- Detail/card actions: `app/(dashboard)/sales/customer-card.tsx`, `app/(dashboard)/purchasing/purchase-order-card.tsx`, `app/(dashboard)/manufacturing/orders/[id]/manufacturing-order-card.tsx`
- Dialog footer actions: `components/manufacturing/manufacturing-completion-dialog.tsx`, `components/card-page/operation-cost-editor.tsx`, `app/(dashboard)/sales/orders/[id]/plan-shipment-dialog.tsx`, `app/(dashboard)/sales/orders/[id]/shipment-costs-dialog.tsx`
- Settings/integration actions: `app/(dashboard)/settings/integrations-section.tsx`, `app/(dashboard)/settings/agent-access-section.tsx`, `app/(dashboard)/settings/reports-section.tsx`
- Inline entity links: `app/(dashboard)/sales/customers-table.tsx`, `app/(dashboard)/purchasing/suppliers-table.tsx`, `app/(dashboard)/inventory/stocktakes/stocktakes-table.tsx`, `app/(dashboard)/inventory/ledger/ledger-table.tsx`

**Recommendation:** Keep the base `Button` primitive small. Add semantic wrappers
only where behavior repeats: icon action, create action, disabled-tooltip action,
and inline entity link. This will reduce page-level `variant/size/className`
drift without hiding normal button usage.

## 27. Destructive Confirmation Patterns

**Proposed shared component:** `ConfirmMutationDialog` / `ConfirmDestructiveAction`.

**Pattern:** Delete/cancel/mark-received/destructive flows use a mix of
`AlertDialog`, `window.confirm`, shared confirm mutation helpers, and custom
dialog footers. The visual and behavioral contract differs across modules.

**Current places:**

- Shared foundation: `components/card-page/use-confirm-mutation.tsx`
- Bulk/list delete: `components/erp-data-grid-list.tsx`
- Variant and lot destructive dialogs: `components/card-page/variant-table.tsx`, `components/card-page/lot-grid-tab.tsx`
- Purchase order status transition uses `window.confirm`: `app/(dashboard)/purchasing/status-badge.tsx`
- Team/member destructive actions: `app/(dashboard)/settings/team-section.tsx`
- Customer/project destructive actions: `app/(dashboard)/sales/customer-card.tsx`
- Sales order line and shipment destructive actions: `app/(dashboard)/sales/orders/[id]/line-items-table.tsx`, `app/(dashboard)/sales/orders/[id]/shipments-table.tsx`, `app/(dashboard)/sales/orders/[id]/mark-shipped-dialog.tsx`
- Inventory lot actions: `app/(dashboard)/inventory/lot-quantity-adjuster.tsx`, `app/(dashboard)/inventory/lot-disposition-actions.tsx`
- Xero/import undo or retry flows: `app/(dashboard)/settings/integrations-section.tsx`, `app/(dashboard)/settings/integrations/xero-import-section.tsx`

**Recommendation:** Use `components/card-page/use-confirm-mutation.tsx` as the
foundation for mutation lifecycle, but expose a visual confirmation component
that handles title/body/action tone and removes remaining `window.confirm` use.

## 28. Form Field Composition And Validation Errors

**Proposed shared components:** `ControlledTextField`, `ControlledTextareaField`,
`ControlledSelectField`, `FormErrorBanner`, `InlineMutationError`.

**Pattern:** The repo has canonical `Field`, `FieldLabel`, and `FieldError`
primitives, but many forms still repeat `Controller` render blocks, conditional
`FieldError`, `aria-invalid`, local error paragraphs, and `FieldDescription`
styled as destructive text.

**Current places:**

- Shared primitives: `components/ui/field.tsx`, `components/address-fields.tsx`
- Auth forms: `components/login-form.tsx`, `components/signup-form.tsx`, `components/forgot-password-form.tsx`, `components/reset-password-form.tsx`, `components/accept-invitation-form.tsx`, `components/email-mfa-form.tsx`, `components/org-setup-form.tsx`
- Address dialogs: `app/(dashboard)/sales/customer-card.tsx`, `app/(dashboard)/sales/orders/[id]/order-details-grid.tsx`, `app/(dashboard)/purchasing/supplier-card.tsx`, `app/(dashboard)/purchasing/purchase-order-card.tsx`
- Card/detail forms: `app/(dashboard)/purchasing/purchase-order-card.tsx`, `app/(dashboard)/sales/pricing-schedule-form.tsx`, `app/(dashboard)/inventory/products/[id]/tabs/general-info.tsx`, `app/(dashboard)/inventory/materials/[id]/tabs/general-info.tsx`, `app/(dashboard)/inventory/materials/[id]/tabs/supply-details.tsx`
- Dialog forms: `components/card-page/variant-table.tsx`, `components/card-page/variant-configuration-dialog.tsx`, `components/card-page/copy-bom-dialog.tsx`, `app/(dashboard)/inventory/lot-disposition-actions.tsx`, `app/(dashboard)/sales/orders/[id]/shipment-costs-dialog.tsx`
- Local destructive paragraphs instead of field/form error primitives: `components/accounting-sync-status.tsx`, `components/manufacturing/manufacturing-completion-dialog.tsx`, `app/(dashboard)/sales/orders/[id]/order-card.tsx`, `app/(dashboard)/sales/orders/[id]/plan-shipment-dialog.tsx`, `app/(dashboard)/purchasing/orders-table.tsx`

**Recommendation:** Keep `Field` as the visual primitive. Add controlled wrappers
only for common text/select/textarea patterns and a generic form-level error
banner so pages stop using `FieldDescription className="text-destructive"` and
raw `<p className="text-sm text-destructive">`.

## 29. Auth Card Forms

**Proposed shared component:** `AuthFormCard` plus `AuthFormFooterLink`.

**Pattern:** Auth and onboarding forms share the same centered card structure,
title/content field stack, submit button loading state, footer link, and error
placement, but each file defines it locally.

**Current places:**

- `components/login-form.tsx`
- `components/signup-form.tsx`
- `components/forgot-password-form.tsx`
- `components/reset-password-form.tsx`
- `components/accept-invitation-form.tsx`
- `components/email-mfa-form.tsx`
- `components/org-setup-form.tsx`
- `app/(auth)/xero/sign-up/link/page.tsx`
- `app/(auth)/xero/sign-up/error/page.tsx`
- `app/(auth)/layout.tsx`

**Recommendation:** Use the existing shadcn `Card` and `FieldGroup` styling as
the foundation, but centralize the card shell, footer link, and loading submit
button. This should remain separate from dashboard `CreatePageShell`.

## 30. Loading And Pending States

**Proposed shared components:** `RouteTableLoading`, `CardRouteLoading`,
`InlineSpinnerState`, `PendingButtonLabel`.

**Pattern:** There are many route-level `loading.tsx` files, small module wrapper
components that only return `DataTableLoading`, local spinner rows, and ad hoc
pending labels (`Saving...`, `Saving…`, `Working…`, `Creating...`, `Copying...`).

**Current places:**

- Shared foundations: `components/data-table-loading.tsx`, `components/dashboard-route-loading.tsx`, `components/ui/spinner.tsx`
- Module wrappers: `app/(dashboard)/sales/data-table-loading.tsx`, `app/(dashboard)/sales/orders-table-loading.tsx`, `app/(dashboard)/manufacturing/data-table-loading.tsx`, `app/(dashboard)/purchasing/data-table-loading.tsx`, `app/(dashboard)/purchasing/orders-table-loading.tsx`, `app/(dashboard)/inventory/data-table-loading.tsx`, `app/(dashboard)/inventory/stocktakes/data-table-loading.tsx`
- Route loading files across sales/inventory/purchasing/manufacturing/settings under `app/(dashboard)/**/loading.tsx`
- Card tab loading: `components/card-page/card-tabs.tsx`, `app/(dashboard)/inventory/products/[id]/(card)/tab-loading.tsx`
- Inline spinner states: `components/card-page/variant-table.tsx`, `app/(dashboard)/settings/integrations/xero-import-section.tsx`, `app/(dashboard)/sales/sales-order-allocator.tsx`, `app/(dashboard)/inventory/item-history-sparkline-card.tsx`
- Pending button labels: `components/card-page/variant-configuration-dialog.tsx`, `components/card-page/copy-bom-dialog.tsx`, `components/manufacturing/manufacturing-completion-dialog.tsx`, `app/(dashboard)/sales/orders/[id]/mark-shipped-dialog.tsx`, `app/(dashboard)/sales/orders/[id]/plan-shipment-dialog.tsx`, `app/(dashboard)/purchasing/purchase-order-card.tsx`

**Recommendation:** Keep `DataTableLoading`, but replace the module one-line
wrappers with direct route usage or a single route helper. Add a tiny pending
label convention so button copy and ellipsis style are consistent.

## 31. Secondary Navigation And Tabs

**Proposed shared components:** `SecondaryNavBar`, `SideSectionNav`,
`RevisionRail`, and a router-aware tab primitive.

**Pattern:** The app has top/module navigation, settings side nav, card tabs, and
BOM revision rail navigation with separate markup and active-state styling. All
are secondary navigation patterns with horizontal overflow, active indicator,
disabled state, and pending-navigation concerns.

**Current places:**

- Top/module subnav: `components/dashboard-top-nav.tsx`
- Pending link foundation: `components/navigation-pending.tsx`
- Card tabs: `components/card-page/card-tabs.tsx`
- Settings side/horizontal nav: `app/(dashboard)/settings/settings-nav.tsx`
- BOM revision rail: `app/(dashboard)/inventory/products/[id]/bom-history/page.tsx`
- Product/material routed tabs: `app/(dashboard)/inventory/products/[id]/product-card.tsx`, `app/(dashboard)/inventory/materials/[id]/material-card.tsx`

**Recommendation:** Keep `NavigationLink` as the routing foundation. Extract the
active/disabled/count/caption styling into shared secondary-nav variants so card
tabs, settings nav, and revision rail do not each define a new selected style.

## 32. Attachments And File Lists

**Proposed shared components:** `AttachmentDialog`, `AttachmentListItem`,
`FileTypeLabel`, `FileUploadControl`.

**Pattern:** Customer project attachments and purchase order attachments both
implement file input, upload disabled states, empty attachment messages, file
rows, delete/download actions, and file-type labels. Purchase orders additionally
show accounting sync state, but the base attachment UI is reusable.

**Current places:**

- Customer project attachments: `app/(dashboard)/sales/customer-card.tsx`
- Purchase order attachments: `app/(dashboard)/purchasing/purchase-order-card.tsx`
- Purchase order file badge: `app/(dashboard)/purchasing/purchase-order-card.tsx` (`FileTypeBadge`)
- File APIs backing the UI: `app/api/customers/[id]/projects/[projectId]/files/route.ts`, `app/api/purchase-orders/[id]/files/route.ts`, `app/api/purchase-orders/[id]/files/[fileId]/route.ts`
- Accounting attachment sync status appears in `components/accounting-sync-status.tsx` and PO attachment rows.

**Recommendation:** Start from purchase order attachments because it covers upload,
delete, download, and sync status. Extract the base file list first, then add
optional sync metadata.

## 33. Clipboard / Copy Feedback

**Proposed shared component:** `CopyButton`.

**Pattern:** Copy-to-clipboard actions use local `navigator.clipboard.writeText`,
local success labels, and inconsistent placement. Some copy actions are domain
copy dialogs rather than clipboard, but the button affordance still overlaps.

**Current places:**

- Clipboard copy: `components/accounting-sync-status.tsx`
- Token copy with temporary label state: `app/(dashboard)/settings/agent-access-section.tsx`
- Stocktake copy action: `app/(dashboard)/inventory/stocktakes/stocktakes-table.tsx`, `app/(dashboard)/inventory/stocktakes/stocktake-detail.tsx`
- Variant/BOM/operations copy dialogs: `components/card-page/variant-configuration-dialog.tsx`, `components/card-page/copy-bom-dialog.tsx`, `app/(dashboard)/inventory/products/[id]/tabs/recipe.tsx`, `app/(dashboard)/inventory/products/[id]/tabs/operations.tsx`

**Recommendation:** Create a focused `CopyButton` for clipboard actions with
standard icon, success label, and error handling. Keep BOM/stocktake duplication
as domain copy actions, but use the same action-button vocabulary from section
26.

## 34. Search Bars, Filter Summaries, And Pagination

**Proposed shared components:** `GridSearchField`, `FilterSummaryBar`,
`PaginationControls`, `RowsPerPageSelect`.

**Pattern:** `ERPDataGrid` includes a basic search input and `ERPDataGridList`
wraps standard list-page search, but several high-traffic screens implement local
search, URL-backed filter state, filter badges, counts, keyboard shortcuts, and
pagination controls.

**Current places:**

- Shared foundation: `components/erp-data-grid.tsx`, `components/erp-data-grid-list.tsx`
- Standard list usage: `app/(dashboard)/inventory/data-table.tsx`, `app/(dashboard)/sales/customers-table.tsx`, `app/(dashboard)/purchasing/orders-table.tsx`, `app/(dashboard)/purchasing/suppliers-table.tsx`, `app/(dashboard)/sales/pricing-schedules-table.tsx`, `app/(dashboard)/inventory/stocktakes/stocktakes-table.tsx`
- Local sales order search with shortcut and status footer: `app/(dashboard)/sales/orders-table.tsx`
- Local manufacturing order search and resource filter: `app/(dashboard)/manufacturing/orders-table.tsx`
- URL-backed ledger search/filter/pagination: `app/(dashboard)/inventory/ledger/ledger-table.tsx`
- Stocktake detail search/count filter: `app/(dashboard)/inventory/stocktakes/stocktake-detail.tsx`
- Sales allocation order and column search: `app/(dashboard)/sales/sales-allocation-table.tsx`
- Pricing schedule item/category search: `app/(dashboard)/sales/pricing-schedule-form.tsx`
- Dashboard page search popover: `components/dashboard-top-nav.tsx`

**Recommendation:** Keep `ERPDataGridList` for normal CRUD lists. Extract a
smaller set of toolbar primitives for custom grids: search field with icon,
active-filter badge list, count summary, page-size select, and previous/next
buttons.

## 35. Browser-Native Alerts And Blocking Warnings

**Proposed shared component:** `BlockingWarningDialog` or route these through
`ConfirmDestructiveAction` when the action mutates data.

**Pattern:** A few flows still use `window.alert` or `window.confirm`. These
escape the app design system, are hard to style/test, and split confirmation
behavior away from the dialog primitives.

**Current places:**

- Stocktake table warning alert: `app/(dashboard)/inventory/stocktakes/stocktakes-table.tsx`
- Stocktake detail warning alert: `app/(dashboard)/inventory/stocktakes/stocktake-detail.tsx`
- Product recipe copy confirmation: `app/(dashboard)/inventory/products/[id]/tabs/recipe.tsx`
- Product operations copy confirmation: `app/(dashboard)/inventory/products/[id]/tabs/operations.tsx`
- Purchase order cancel confirmation in card: `app/(dashboard)/purchasing/purchase-order-card.tsx`
- Purchase order status confirmation helper: `app/(dashboard)/purchasing/status-badge.tsx`

**Recommendation:** Fold true destructive confirmations into section 27’s shared
confirmation component. For non-mutating warnings, add a small warning dialog
that uses the same footer/action layout.

## 36. Card Page And Settings Panel Primitives

**Proposed shared component:** document and tighten `CardSection`,
`SettingsPanel`, and `SettingsPanelHeader`; merge them only if their roles are
actually the same.

**Pattern:** The app already has useful card-page primitives, and settings has a
parallel panel vocabulary. The gap is not absence of code; it is unclear
ownership. New detail sections can choose between shadcn `Card`, `CardSection`,
`CreateSection`, local bordered divs, or `SettingsPanel`, which keeps surface
spacing and header treatment from converging.

**Current places:**

- Shared card-page primitives: `components/card-page/card-page.tsx`,
  `components/card-page/card-page-header.tsx`,
  `components/card-page/card-page-two-column.tsx`,
  `components/card-page/card-meta-strip.tsx`,
  `components/card-page/detail-header-title.tsx`,
  `components/card-page/commit-input.tsx`,
  `components/card-page/notes-field.tsx`,
  `components/card-page/item-card-fields.tsx`
- Shared settings primitives: `app/(dashboard)/settings/settings-panel.tsx`
- Card-page usage: `app/(dashboard)/sales/customer-card.tsx`,
  `app/(dashboard)/purchasing/supplier-card.tsx`,
  `app/(dashboard)/purchasing/purchase-order-card.tsx`,
  `app/(dashboard)/sales/orders/[id]/order-card.tsx`,
  `app/(dashboard)/manufacturing/orders/[id]/manufacturing-order-card.tsx`,
  `app/(dashboard)/inventory/stocktakes/stocktake-detail.tsx`,
  `app/(dashboard)/inventory/products/[id]/product-card.tsx`,
  `app/(dashboard)/inventory/materials/[id]/material-card.tsx`
- Tab/section usage: `app/(dashboard)/inventory/products/[id]/tabs/general-info.tsx`,
  `app/(dashboard)/inventory/materials/[id]/tabs/general-info.tsx`,
  `app/(dashboard)/inventory/materials/[id]/tabs/supply-details.tsx`,
  `app/(dashboard)/inventory/products/[id]/tabs/recipe.tsx`,
  `app/(dashboard)/inventory/products/[id]/tabs/operations.tsx`,
  `app/(dashboard)/inventory/materials/[id]/tabs/used-in-boms.tsx`
- Settings usage: `app/(dashboard)/settings/team-section.tsx`,
  `app/(dashboard)/settings/tax-rates-section.tsx`,
  `app/(dashboard)/settings/agent-access-section.tsx`,
  `app/(dashboard)/settings/reports-section.tsx`,
  `app/(dashboard)/settings/account-section.tsx`,
  `app/(dashboard)/settings/integrations-section.tsx`

**Recommendation:** Make `CardSection` the default for ERP record cards and
`SettingsPanel` the default for settings pages, then add a short rule in the
component docs that explains when to use each. If their props keep converging,
extract a common `PanelHeader` and `PanelBody` rather than maintaining duplicate
surface styling.

## 37. Date And Date-Time Field Variants

**Proposed shared components:** `DateField`, `DateFilterField`,
`DateTimeField`, and `GridDateCellEditor`.

**Pattern:** Date pickers exist, but call sites still decide their own label,
placeholder, disabled, invalid, formatting, and filter behavior. Grid editing has
a separate editor. This makes date inputs feel slightly different across cards,
dialogs, filters, and editable tables.

**Current places:**

- Shared foundations: `components/ui/date-picker.tsx`,
  `components/ui/date-time-picker.tsx`,
  `components/ag-grid-date-cell-editor.tsx`
- Stock adjustment date-time picker: `components/card-page/variant-table.tsx`
- Reports date filters: `app/(dashboard)/settings/reports-section.tsx`
- Manufacturing creation dialog due date: `app/(dashboard)/sales/create-manufacturing-orders-dialog.tsx`
- Ledger date filters: `app/(dashboard)/inventory/ledger/ledger-table.tsx`
- Manufacturing order card date fields: `app/(dashboard)/manufacturing/orders/[id]/manufacturing-order-card.tsx`
- Purchase order card date fields: `app/(dashboard)/purchasing/purchase-order-card.tsx`
- Shipment planning date field: `app/(dashboard)/sales/orders/[id]/plan-shipment-dialog.tsx`
- Sales order detail date fields: `app/(dashboard)/sales/orders/[id]/order-details-grid.tsx`

**Recommendation:** Keep the low-level picker components, but wrap them in
domain-neutral field components that own labels, invalid states, placeholders,
and value conversion. Grid date editing should stay separate but export through
the same naming family.

## 38. Chart And Metric Visual Cards

**Proposed shared components:** `MetricCard`, `MiniChartCard`,
`DonutBreakdown`, and `MetricList`.

**Pattern:** Inventory and settings have several compact visual summaries. They
share the same ingredients, but each call site builds its own card, metric label,
legend, and empty state. `components/ui/chart.tsx` is a good low-level
foundation, but the ERP-specific card patterns are still bespoke.

**Current places:**

- Shared chart foundation: `components/ui/chart.tsx`
- Item history sparkline card: `app/(dashboard)/inventory/item-history-sparkline-card.tsx`
- Inventory commitment donut: `app/(dashboard)/inventory/inventory-commitment-donut.tsx`
- Commitment summary card: `app/(dashboard)/inventory/item-commitment-summary-card.tsx`
- Reports summary metric cards: `app/(dashboard)/settings/reports-section.tsx`
- Xero import preview metrics and samples:
  `app/(dashboard)/settings/integrations/xero-import-section.tsx`

**Recommendation:** Do not abstract chart internals first. Extract the repeated
outer card and metric/legend vocabulary, then let individual chart bodies stay
custom until at least two surfaces need the same visual shape.

## 39. Progress Bars, Timelines, And Legends

**Proposed shared components:** `SegmentedProgressBar`, `InlineProgressBar`,
`Timeline`, and `Legend`.

**Pattern:** Fulfillment, manufacturing, allocation, and accounting sync all show
state over time or partial completion. These components use similar tone maps,
markers, labels, and bar segments, but they are implemented locally.

**Current places:**

- Accounting sync timeline and status steps: `components/accounting-sync-status.tsx`
- Manufacturing production progress bar: `app/(dashboard)/manufacturing/orders-table.tsx`
- Linked manufacturing progress in sales order action cells:
  `app/(dashboard)/sales/sales-order-table-action-cells.tsx`
- Sales allocation row progress and legend:
  `app/(dashboard)/sales/sales-allocation-table.tsx`
- Manufacturing pick progress badge:
  `app/(dashboard)/manufacturing/pick-progress-badge.tsx`

**Recommendation:** Extract progress primitives by shape, not by domain. A
segmented bar should accept typed segments and an accessible label. A timeline
should own node spacing and status icons. Domain code should only provide labels,
tones, and counts.

## 40. Sales Allocation Matrix Controls

**Proposed shared components:** `AllocationMatrixToolbar`, `AllocationLegend`,
`AllocationCell`, `SectionBannerRow`, and `AllocationGridTheme`.

**Pattern:** The sales allocation table is a full bespoke interaction surface
with a large CSS module and many local components. Some of that should remain
domain-specific, but the toolbar, legend, section rows, markers, cell treatment,
and scroll shell are reusable allocation-matrix primitives.

**Current places:**

- CSS module: `app/(dashboard)/sales/sales-allocation-table.module.css`
- Local components: `FamilyHeader`, `VariantHeader`, `OrderIdentityCell`,
  `ShipDateCell`, `CoverageVariantCell`, `AllocationProductCell`,
  `SectionBannerRow`, `LegendItem`, `AllocationLegend`, `AllocationToolbar`,
  `SalesAllocationTable`

**Recommendation:** Give this surface a dedicated extraction pass after the
general shells, status, and toolbar primitives exist. Do not prematurely force it
into `ERPDataGrid`; preserve the allocation-specific matrix behavior while
standardizing the surrounding controls.

## 41. Settings And Integration Local Components

**Proposed shared components:** `IntegrationProviderCard`,
`IntegrationStatusRow`, `ProviderLogoMark`, `SettingsSubHeader`, and
`ImportPreviewPanel`.

**Pattern:** Settings integrations, Xero import, and agent access contain many
local helper components that solve the same problems: provider cards, status
rows, logo marks, default chips, import previews, summary metrics, and connection
dialogs. The surfaces are related enough to share vocabulary, but the helpers are
currently scoped to individual files.

**Current places:**

- Integration helpers and dialogs: `app/(dashboard)/settings/integrations-section.tsx`
  (`FriendlyTax`, `FriendlyStatus`, `TaxSelect`, `DotBadge`, `XeroLogo`,
  `DefaultChip`, `SectionHeading`, `AutomationRow`, `PostingDefaultsSummary`,
  `ImportFromXeroSection`, `XeroRow`, `QuickBooksRow`,
  `PostingDefaultsDialog`, `DisconnectDialog`, `AutoPushConfirmDialog`,
  `SwitchOrgDialog`, `ConnectDialog`, `ExportHistoryDialog`)
- Xero import helpers: `app/(dashboard)/settings/integrations/xero-import-section.tsx`
  (`ImportActionGroup`, `ImportSummary`, `PurchaseOrderImportSummary`,
  `PurchaseOrderImportDialog`, `ImportActionDialog`, `ImportPreviewDetails`,
  `PreviewMetric`, `PreviewSamples`)
- Agent access helpers: `app/(dashboard)/settings/agent-access-section.tsx`
  (`AgentTokenDialog`, `ProviderMark`, `ClaudeConnectDialog`,
  `ChatGptConnectDialog`, `ConnectCard`, `SubHeader`)

**Recommendation:** Start with provider-card and preview-panel primitives, then
move repeated logo/status/chip treatments under those. Keep provider-specific
copy and auth flows local.

## 42. Attribute And Metadata Tags

**Proposed shared components:** `AttributeTagList`, `ItemTypeTag`,
`MetadataTag`, and `MarginLabel`.

**Pattern:** Badge use is already widespread, but attribute and metadata tags are
a narrower repeated pattern: item type badges, variant attribute chips, margin
labels, and generated badge variant cycles. These are not the same as workflow
status badges and should not share the same API.

**Current places:**

- Manufacturing attribute badges: `app/(dashboard)/manufacturing/orders-table.tsx`
- Sales order line attribute badges: `app/(dashboard)/sales/order-line-attribute-badges.tsx`
- Inventory column metadata badges: `app/(dashboard)/inventory/columns.tsx`
- Inventory item combobox type badge: `components/inventory-item-combobox.tsx`
- Pricing schedule item/category tags: `app/(dashboard)/sales/pricing-schedule-form.tsx`

**Recommendation:** Split metadata tags from status badges. A tag-list component
should handle overflow/count behavior and variant cycling; item type and margin
labels should use named tone maps so grid cells, combobox options, and forms stay
consistent.

## 43. Print Actions

**Proposed shared component:** `PrintAction` or a `CardPageHeader` print-action
slot with condition support.

**Pattern:** `CardPageHeader` has a built-in print action, but several card pages
disable it and then re-add a local `window.print()` action so they can control
ordering or conditions. That leaves print labels, visibility, and menu placement
as per-page behavior.

**Current places:**

- Shared foundation: `components/card-page/card-page-header.tsx`
- Stocktake detail: `app/(dashboard)/inventory/stocktakes/stocktake-detail.tsx`
- Manufacturing order card: `app/(dashboard)/manufacturing/orders/[id]/manufacturing-order-card.tsx`
- Customer card: `app/(dashboard)/sales/customer-card.tsx`
- Supplier card: `app/(dashboard)/purchasing/supplier-card.tsx`
- Purchase order card: `app/(dashboard)/purchasing/purchase-order-card.tsx`
- Sales order card: `app/(dashboard)/sales/orders/[id]/order-card.tsx`

**Recommendation:** Keep the actual print behavior in `CardPageHeader`, but let
call sites provide `showPrint`, `printDisabled`, `printHidden`, or an explicit
action placement. Pages should not need to create their own `{ label: "Print",
onClick: () => window.print() }` objects.

## 44. Checkbox, Radio, And Switch Option Rows

**Proposed shared components:** `OptionRow`, `CheckboxOptionRow`,
`RadioOptionCard`, and `SettingsToggleRow`.

**Pattern:** Checkbox, radio, and switch controls are visually composed by hand:
some use compact inline labels, some use bordered option cards, some use
two-column setting rows, and some put helper/error text in local paragraphs.
The base shadcn controls are present, but the ERP option-row layout is not.

**Current places:**

- Auth remembered/session options: `components/login-form.tsx`,
  `components/email-mfa-form.tsx`
- Bulk/status option rows: `components/accounting-sync-status.tsx`,
  `components/card-page/order-status-configs.tsx`,
  `app/(dashboard)/sales/orders/[id]/mark-shipped-dialog.tsx`
- BOM/copy options: `components/card-page/copy-bom-dialog.tsx`,
  `app/(dashboard)/inventory/bom-editor.tsx`,
  `app/(dashboard)/inventory/products/[id]/tabs/recipe.tsx`
- Settings toggles/options: `app/(dashboard)/settings/reports-section.tsx`,
  `app/(dashboard)/settings/integrations-section.tsx`
- Item/card booleans: `app/(dashboard)/inventory/products/[id]/tabs/general-info.tsx`,
  `app/(dashboard)/inventory/materials/[id]/tabs/general-info.tsx`,
  `app/(dashboard)/inventory/materials/[id]/tabs/supply-details.tsx`
- Stocktake scope radio cards: `app/(dashboard)/inventory/stocktakes/create-stocktake-dialog.tsx`
- Dialog line selection: `app/(dashboard)/sales/create-manufacturing-orders-dialog.tsx`,
  `app/(dashboard)/settings/integrations/xero-import-section.tsx`,
  `app/(dashboard)/purchasing/purchase-order-card.tsx`

**Recommendation:** Extract visual wrappers, not new boolean logic. The wrapper
should own control/label/help/error alignment, disabled opacity, and optional
bordered-card treatment. Settings-specific switch rows can sit on top of the
same primitive.

## 45. Large Entity Picker Dialogs

**Proposed shared components:** `EntityPickerDialog`, `PickerToolbar`,
`PickerListRow`, `PickerSelectionSummary`, and `CreateFromPickerAction`.

**Pattern:** Several workflows open a large dialog to select many entities,
toggle categories/tabs, show selected counts, and optionally create related
records. These are not normal comboboxes and not normal form dialogs; they are
picker workspaces with repeated search, selected-state, count, and footer
patterns.

**Current places:**

- Pricing schedule item/category picker:
  `app/(dashboard)/sales/pricing-schedule-form.tsx`
- Sales order to manufacturing order selection:
  `app/(dashboard)/sales/create-manufacturing-orders-dialog.tsx`
- Xero import candidate picker:
  `app/(dashboard)/settings/integrations/xero-import-section.tsx`
- Sales allocation source picker:
  `app/(dashboard)/sales/sales-order-allocator.tsx`
- Manufacturing lot picker entry points:
  `app/(dashboard)/manufacturing/orders/[id]/manufacturing-order-card.tsx`,
  `components/manufacturing/lot-strategy-chip.tsx`
- Copy target/source picker: `components/card-page/copy-bom-dialog.tsx`,
  `components/card-page/variant-configuration-dialog.tsx`
- Create-related-record dialogs launched from field editors:
  `components/card-page/operation-cost-editor.tsx`,
  `app/(dashboard)/sales/pricing-schedule-form.tsx`

**Recommendation:** Start with the pricing schedule picker because it covers
tabs, selected summaries, selectable rows, and a create-category branch. Keep
domain data loading outside the shared component; standardize the dialog frame,
selection affordance, footer count, and search/filter controls.

## 46. Error, Notice, And Result Surfaces

**Proposed shared components:** `ErrorStateCard`, `NoticeBanner`,
`InlineActionError`, `SuccessNotice`, and `EmptyResultCard`.

**Pattern:** Field-level errors have a primitive, but page, dialog, action, and
result notices are still highly local. The app mixes bordered destructive
banners, plain destructive paragraphs, `FieldDescription` colored as
destructive, dialog footer errors, route error cards, and success text.

**Current places:**

- Route/global error surfaces: `app/error.tsx`, `app/global-error.tsx`
- Xero signup result page: `app/(auth)/xero/sign-up/error/page.tsx`
- Auth/onboarding notices: `components/login-form.tsx`,
  `components/signup-form.tsx`, `components/reset-password-form.tsx`,
  `components/accept-invitation-form.tsx`, `components/org-setup-form.tsx`
- Generic delete/action error banner: `components/erp-data-grid-list.tsx`
- Card save/action banners: `app/(dashboard)/sales/orders/[id]/order-card.tsx`,
  `app/(dashboard)/manufacturing/orders/[id]/manufacturing-order-card.tsx`,
  `app/(dashboard)/inventory/products/[id]/product-card.tsx`,
  `app/(dashboard)/inventory/materials/[id]/material-card.tsx`
- Dialog/action errors: `components/manufacturing/manufacturing-completion-dialog.tsx`,
  `components/card-page/variant-configuration-dialog.tsx`,
  `components/card-page/use-confirm-mutation.tsx`,
  `components/card-page/lot-grid-tab.tsx`,
  `app/(dashboard)/sales/orders/[id]/plan-shipment-dialog.tsx`,
  `app/(dashboard)/sales/orders/[id]/shipment-costs-dialog.tsx`,
  `app/(dashboard)/sales/orders/[id]/mark-shipped-dialog.tsx`
- Settings and import notices: `app/(dashboard)/settings/reports-section.tsx`,
  `app/(dashboard)/settings/team-section.tsx`,
  `app/(dashboard)/settings/integrations-section.tsx`,
  `app/(dashboard)/settings/integrations/xero-import-section.tsx`,
  `app/(dashboard)/settings/agent-access-section.tsx`
- Inventory/allocation inline errors: `components/manufacturing/ingredient-lot-card.tsx`,
  `app/(dashboard)/sales/sales-order-allocator.tsx`,
  `app/(dashboard)/inventory/bom-editor.tsx`,
  `app/(dashboard)/inventory/lot-disposition-actions.tsx`,
  `app/(dashboard)/inventory/lot-quantity-adjuster.tsx`

**Recommendation:** Use `FieldError` only for field-level validation. Add a
small notice system for page/dialog/action results with tone, title/body,
optional action, and `role="alert"`/`aria-live` behavior. This should also
replace one-off destructive `FieldDescription` usage.

## 47. Save Status Indicators

**Proposed shared components:** `SaveStatusIndicator`, `AutosaveStatusText`, and
one shared save-status hook contract.

**Pattern:** Record cards and forms show saving/saved/failed state with separate
implementations. `CardPageHeader` already accepts save state and message, but
the state derivation and visual output are split between card-page utilities,
customer-card utilities, and a generic autosave text component.

**Current places:**

- Shared card-page foundation: `components/card-page/card-save-status.tsx`,
  `components/card-page/use-card-save-status.ts`,
  `components/card-page/card-page-header.tsx`
- Customer-specific save state hook:
  `components/customer-card/use-customer-save-status.ts`
- Generic text status: `components/autosave-status.tsx`
- Product/material card composition:
  `app/(dashboard)/inventory/products/[id]/product-card.tsx`,
  `app/(dashboard)/inventory/materials/[id]/material-card.tsx`
- Sales and manufacturing action error/save banners also overlap with this
  pattern: `app/(dashboard)/sales/orders/[id]/order-card.tsx`,
  `app/(dashboard)/manufacturing/orders/[id]/manufacturing-order-card.tsx`

**Recommendation:** Use `components/card-page/card-save-status.tsx` as the
foundation. Generalize `useEntitySaveStatus` so customer and item cards do not
need separate hooks, and reserve `AutosaveStatus` for plain inline text when a
card header pill is not appropriate.

## 48. Unclassified Imported UI Primitives

**Proposed action:** classify as `UnusedExternalPrimitive` or promote into a
documented ERP component only when a real workflow adopts it.

**Pattern:** The repo contains several UI primitives or primitive sets that are
not used by current ERP screens. They are not currently bespoke workflow
patterns, but they are UI surface area that future agents may copy without
knowing whether they are approved.

**Current places:**

- Drag-and-drop primitive implementation only: `components/reui/kanban.tsx`
- Status bar primitive implementation only: `components/ui/status-ribbon.tsx`
- Menubar primitive implementation only: `components/ui/menubar.tsx`
- Theme toggle implementation only: `components/theme-toggle.tsx`
- Breadcrumb primitive implementation only: `components/ui/breadcrumb.tsx`
- Collapsible primitive implementation only: `components/ui/collapsible.tsx`
- Scroll-area primitive implementation only: `components/ui/scroll-area.tsx`
- No current app/component imports found by static scan for these primitives.

**Recommendation:** Do not use this as a cleanup foundation unless a Kanban
or menubar-style workflow is actually planned. Either document each as
intentionally available but unused, or remove it in a separate dead-code cleanup
if no owner exists.

## 49. Standalone Result And Utility Pages

**Proposed shared components:** `StandaloneResultPage`, `AccessPendingPage`,
and `UtilityDownloadPage`.

**Pattern:** Pages outside normal dashboard modules build centered, card-like
utility pages by hand. They overlap with auth result cards and error-state cards,
but currently own their own max width, vertical centering, explanatory text, and
primary/secondary action layout.

**Current places:**

- No-access result page: `app/(dashboard)/no-access/page.tsx`
- Android app download page: `app/android/page.tsx`
- Xero signup link page: `app/(auth)/xero/sign-up/link/page.tsx`
- Xero signup error page: `app/(auth)/xero/sign-up/error/page.tsx`
- App route error card: `app/error.tsx`
- Auth layout wrapper: `app/(auth)/layout.tsx`

**Recommendation:** Build this on top of section 46's notice/error/result
surface work. The shared page should own centered-page spacing, title/body/action
slots, and optional card treatment so utility pages do not re-create one-off
frames.

## 50. Access, Role, And Permission Badges

**Proposed shared components:** `RoleBadge`, `AccessPresetBadge`,
`InviteStatusBadge`, and `PermissionLevelTag`.

**Pattern:** Access-related badges are distinct from operational statuses and
metadata tags. Settings team management maps roles, access presets, invitation
state, and module access levels to local badge variants and labels.

**Current places:**

- Role badge foundation: `app/(dashboard)/settings/team-role-badge.tsx`
- Local access preset badge: `app/(dashboard)/settings/team-section.tsx`
  (`AccessPresetBadge`)
- Local member/invite status badge: `app/(dashboard)/settings/team-section.tsx`
  (`TeamStatusBadge`)
- Access level chooser labels and toggle groups:
  `app/(dashboard)/settings/team-section.tsx`
- Role/access formatting source: `lib/authz.ts`

**Recommendation:** Keep formatting in `lib/authz.ts`, but move visual badge
mapping into shared settings/team UI. Do not merge these with sales,
manufacturing, or inventory status badges; access badges have a different
meaning and lifecycle.

## 51. Settings Key-Value Rows

**Proposed shared components:** `SettingsKeyValueRow`, `SettingsRows`, and
`SettingsInlineAction`.

**Pattern:** Settings account and integration sections repeatedly show a label,
current value, and right-side action in bordered rows. Each section currently
chooses its own grid columns, padding, truncation, and action alignment.

**Current places:**

- Account row helper: `app/(dashboard)/settings/account-section.tsx` (`Row`)
- Integration automation rows:
  `app/(dashboard)/settings/integrations-section.tsx` (`AutomationRow`)
- Posting defaults summary rows:
  `app/(dashboard)/settings/integrations-section.tsx`
  (`PostingDefaultsSummary`)
- Team member/invite rows:
  `app/(dashboard)/settings/team-section.tsx`
- Reports recipient and history rows:
  `app/(dashboard)/settings/reports-section.tsx`
- Agent token/provider rows:
  `app/(dashboard)/settings/agent-access-section.tsx`

**Recommendation:** Extract a settings-row primitive after `SettingsPanel`
ownership is settled. It should support label/value/action, optional supporting
text, and compact grid variants without turning every row into a custom grid.

## 52. Inline Style And Hardcoded Layout Exceptions

**Proposed shared approach:** replace one-off `style` objects and raw spacing
with named component props, CSS-module classes, or token-backed primitives.

**Pattern:** Most styling now uses semantic classes and V2 tokens, but scattered
inline styles still control layout gaps, progress widths, colors, z-index stacks,
and margins. Some are legitimate dynamic values, but many are symptoms of a
missing shared visual primitive.

**Current places:**

- Two-column card layout uses inline row/column gaps:
  `components/card-page/card-page-two-column.tsx`
- Toggle group spacing writes a CSS variable directly:
  `components/ui/toggle-group.tsx`
- Variant configuration warning/error colors use inline style:
  `components/card-page/variant-configuration-dialog.tsx`
- Inventory token stack z-index uses inline style:
  `components/inventory-visuals/item-token-stack.tsx`
- Dynamic progress/meter widths:
  `app/(dashboard)/sales/sales-order-table-action-cells.tsx`,
  `app/(dashboard)/sales/sales-allocation-table.tsx`,
  `app/(dashboard)/inventory/columns.tsx`
- Recipe/operations helper margins:
  `app/(dashboard)/inventory/products/[id]/tabs/recipe.tsx`,
  `app/(dashboard)/inventory/products/[id]/tabs/operations.tsx`
- BOM history color/swatch style:
  `app/(dashboard)/inventory/materials/[id]/tabs/used-in-boms.tsx`

**Recommendation:** Keep inline numeric widths where they represent actual data
visualization, but hide them behind progress/meter components from sections 39
and 40. Replace static spacing/color style objects with classes or component
props.

## 53. Native Compact Tables And Table Fragments

**Proposed shared components:** `CompactTable`, `MiniDataTable`,
`DialogSelectionTable`, and `ReadOnlySummaryTable`.

**Pattern:** `ERPDataGrid` handles dense operational grids and shadcn `Table`
handles base table markup, but many card/dialog/report surfaces still assemble
small tables with one-off headers, padding, numeric alignment, empty rows, and
scroll wrappers. Some use shadcn `Table`; others use raw `<table>`.

**Current places:**

- Raw sales fulfillment tables:
  `app/(dashboard)/sales/orders/[id]/order-card.tsx`
  (`SalesFulfillmentTable`, remaining/shipped/linked manufacturing tables)
- Raw open-orders table: `app/(dashboard)/sales/customer-card.tsx`
- Raw stocktake completion review table:
  `app/(dashboard)/inventory/stocktakes/stocktake-detail.tsx`
- Demand coverage shadcn tables:
  `app/(dashboard)/sales/demand-queue-coverage-table.tsx`
- BOM history shadcn table:
  `app/(dashboard)/inventory/products/[id]/bom-history/page.tsx`
- Dialog selection shadcn tables:
  `app/(dashboard)/sales/create-manufacturing-orders-dialog.tsx`,
  `app/(dashboard)/sales/orders/[id]/plan-shipment-dialog.tsx`,
  `components/card-page/order-status-configs.tsx`
- Settings/report/import shadcn tables:
  `app/(dashboard)/settings/reports-section.tsx`,
  `app/(dashboard)/settings/integrations/xero-import-section.tsx`
- Manufacturing lot source table:
  `components/manufacturing/ingredient-lot-card.tsx`

**Recommendation:** Keep AG Grid as the default for large ERP datasets. Add a
small compact-table primitive for read-only summaries and dialog selection
tables so padding, numeric alignment, empty rows, and sticky headers do not keep
being rebuilt.

## 54. Local Duplicates Of Existing Shared Utilities

**Proposed shared components:** use the existing shared utilities, or extend
their props when one local version has a legitimate extra behavior.

**Pattern:** Some files define local helpers/components that already exist in
`components/`. These are high-priority cleanup targets because they make future
agents miss the intended shared path.

**Current places:**

- Shared delivery address input:
  `components/delivery-address-input.tsx`
- Local delivery address input duplicate:
  `app/(dashboard)/purchasing/purchase-order-card.tsx`
- Shared quantity display: `components/quantity-with-unit.tsx`
- Local quantity-with-unit formatting helpers:
  `app/(dashboard)/purchasing/purchase-order-card.tsx`,
  `app/(dashboard)/inventory/item-history-sparkline-card.tsx`
- Shared `DateTimeText` is used in several grids, but some report/table
  surfaces still call local date formatters:
  `app/(dashboard)/settings/reports-section.tsx`,
  `app/(dashboard)/inventory/products/[id]/bom-history/page.tsx`

**Recommendation:** Start with `DeliveryAddressInput`: the purchase order local
copy adds read-only rendering and label-class support, which should become props
on the shared component. Then replace local quantity/date formatting with
shared display components where rendering, not pure string generation, is the
goal.

## 55. Generated Document Templates

**Proposed shared components:** `PdfDocumentFrame`, `PdfTable`,
`PdfAddressBlock`, and `PdfSignatureRow`.

**Pattern:** The bill-of-lading PDF is a separate React renderer target, so it
cannot reuse DOM/shadcn components. It still has bespoke document layout,
address blocks, meta rows, table rows, and signature blocks that future PDFs will
likely copy.

**Current places:**

- PDF document template: `lib/pdf/bol-document.tsx`
- BOL PDF routes:
  `app/api/sales-orders/[id]/bol/route.tsx`,
  `app/api/sales-orders/[id]/shipments/[shipmentId]/bol/route.tsx`
- Related accounting document email surface:
  `lib/email/accounting-documents.ts`

**Recommendation:** Do not mix this with browser UI primitives. Create a small
PDF-only primitive set when the second generated document appears, and use this
BOL as the foundation for address blocks, compact tables, meta rows, and
signature rows.

## 56. Email Template Systems

**Proposed shared components:** `EmailPanel`, `EmailButton`,
`EmailDataTable`, `EmailSectionHeader`, `EmailBrandHeader`, and
`EmailFallbackLink`.

**Pattern:** Auth/team emails use a React Email `EmailLayout` and shared
`emailStyles`, daily manufacturing reports use their own table-based React Email
layout, and accounting documents are generated from raw HTML strings. These are
different renderer constraints than browser UI, but they repeat the same brand
header, panel, CTA, fallback link, data table, and footer patterns.

**Current places:**

- Shared React Email foundation:
  `lib/email/components/layout.tsx`
- Auth/team React Email templates:
  `lib/email/components/team-invite.tsx`,
  `lib/email/components/password-reset.tsx`,
  `lib/email/components/email-verification.tsx`,
  `lib/email/components/mfa-code.tsx`
- Daily manufacturing report email:
  `lib/email/components/daily-manufacturing-report.tsx`
- Raw HTML accounting document email:
  `lib/email/accounting-documents.ts`
- Email render/send entry points:
  `lib/email/auth-emails.tsx`, `lib/email/team-invites.tsx`,
  `lib/email/send.ts`

**Recommendation:** Treat email as its own component system, separate from
browser and PDF primitives. Use `EmailLayout` as the base for account/team
messages, then extract a table/report variant from the daily manufacturing
email. Move accounting document emails away from hand-concatenated HTML once the
shared email table and CTA primitives exist.

## 57. Under-Adopted Shared Primitives

**Proposed action:** either promote these into the documented standard path or
remove them if they are abandoned experiments.

**Pattern:** Several shared components already exist for common UI behaviors,
but scans show little or no adoption. That is different from needing a new
component: these need ownership decisions so future agents know whether to use
them, extend them, or ignore them.

**Current places:**

- Disabled action tooltip exists but has no current call sites:
  `components/disabled-tooltip-button.tsx`
- Compact detail action row exists but most detail pages use card-page/local
  action rows instead: `components/detail-page-actions.tsx`
- Data-table status filter exists, while manufacturing/stocktake/pricing
  screens use local `ToggleGroup` filters:
  `components/data-table-status-filter.tsx`,
  `app/(dashboard)/manufacturing/orders-table.tsx`,
  `app/(dashboard)/inventory/stocktakes/stocktake-detail.tsx`,
  `app/(dashboard)/sales/pricing-schedule-form.tsx`
- Sortable reorder primitive exists, while current reorder/priority UIs are
  local grid interactions or endpoint-driven flows:
  `components/sortable-reorder.tsx`,
  `app/(dashboard)/sales/orders-table.tsx`,
  `app/(dashboard)/manufacturing/orders-table.tsx`,
  `components/card-page/operation-cost-editor.tsx`,
  `app/(dashboard)/inventory/bom-editor.tsx`
- Tooltip header has good adoption but nearby table headers still build raw
  tooltip patterns:
  `components/tooltip-header.tsx`,
  `components/sortable-header.tsx`,
  `components/filterable-header.tsx`

**Recommendation:** Start with `DataTableStatusFilter` and
`DisabledTooltipButton` because they are small and easy to either standardize or
delete. Document these decisions in `docs/reusable-components.md` so future
agents do not create a third local version.

## 58. Bulk Selection And Bulk Action Bars

**Proposed shared component:** `BulkActionToolbar`, `SelectionCountBadge`,
`BulkDeleteConfirm`, or `SelectionSummary`.

**Pattern:** `ERPDataGrid` already owns row selection mechanics, but list pages,
dialogs, and workflow tables repeatedly build local selected-count copy,
select-all controls, delete/confirm actions, and bulk operation affordances.
These patterns should share one density, action order, pending state, and
confirmation language.

**Current places:**

- Shared foundation:
  `components/erp-data-grid.tsx`,
  `components/erp-data-grid-list.tsx`
- Sales list bulk actions:
  `app/(dashboard)/sales/orders-table.tsx`
- Generic list bulk deletes:
  `app/(dashboard)/sales/customers-table.tsx`,
  `app/(dashboard)/sales/pricing-schedules-table.tsx`,
  `app/(dashboard)/inventory/data-table.tsx`,
  `app/(dashboard)/purchasing/orders-table.tsx`,
  `app/(dashboard)/purchasing/suppliers-table.tsx`,
  `app/(dashboard)/manufacturing/resources/resources-client.tsx`
- Import and generated-order selection:
  `app/(dashboard)/settings/integrations/xero-import-section.tsx`,
  `app/(dashboard)/sales/create-manufacturing-orders-dialog.tsx`
- Card/workflow line selection:
  `components/card-page/order-status-configs.tsx`,
  `components/card-page/copy-bom-dialog.tsx`

**Recommendation:** Keep `ERPDataGrid` as the grid-selection foundation, then
extract only the visible toolbar/count/confirm/select-all pieces. The shared
piece should support destructive actions, status transitions, import creation,
and dialog-local selection without forcing every surface into a full grid.

## 59. Reorder, Priority, And Drag Handles

**Proposed shared component:** `ReorderHandleCell`, `PriorityReorderGrid`, or a
documented `ERPDataGrid` / `EditableLineDataGrid` reorder API.

**Pattern:** Priority rank, row drag, and line reordering exist in several
domains, but each surface owns its own handle visibility, explanatory text,
pending/error behavior, and API handoff. A `SortableReorder` primitive also
exists, but current grid workflows mostly bypass it.

**Current places:**

- Shared grid/list foundations:
  `components/erp-data-grid.tsx`,
  `components/editable-line-data-grid.tsx`,
  `components/sortable-reorder.tsx`
- Item card variant order:
  `components/card-page/variant-table.tsx`,
  `components/card-page/use-item-card-draft-controller.ts`,
  `app/(dashboard)/inventory/products/[id]/product-card.tsx`,
  `app/(dashboard)/inventory/materials/[id]/material-card.tsx`
- Sales order line order and priority:
  `app/(dashboard)/sales/orders/[id]/line-items-table.tsx`,
  `app/(dashboard)/sales/orders/[id]/use-sales-order-draft-controller.ts`,
  `app/(dashboard)/sales/orders-table.tsx`,
  `lib/schemas/sales-orders.ts`
- Manufacturing priority and operation/BOM ordering:
  `app/(dashboard)/manufacturing/orders-table.tsx`,
  `app/(dashboard)/manufacturing/orders/[id]/manufacturing-order-card.tsx`,
  `components/card-page/operation-cost-editor.tsx`,
  `app/(dashboard)/inventory/bom-editor.tsx`,
  `lib/schemas/manufacturing-orders.ts`,
  `lib/api/clients/manufacturing-orders.ts`
- Reorder endpoints and copy:
  `app/api/item-cards/[itemId]/variants/reorder/route.ts`,
  `app/api/sales-orders/priority-ranks/route.ts`,
  `app/api/manufacturing-orders/priority-ranks/route.ts`,
  `lib/tooltip-copy.ts`

**Recommendation:** Treat grid row reorder as a first-class shared behavior,
with one handle cell, disabled state, tooltip string, pending state, and error
rollback pattern. Decide whether `components/sortable-reorder.tsx` is the
non-grid primitive or dead code before more local reorder UIs appear.

## 60. View Preferences, Column Visibility, And Persistent View State

**Proposed shared component:** `ViewPreferencesMenu`, `ColumnVisibilityMenu`, or
`PersistedViewToolbar`.

**Pattern:** Persisted view state is partially centralized, but user-facing
controls for visible columns, visible allocation families, refresh timestamps,
and allocator preferences are bespoke. The visual treatment and persistence
model should be explicit so new grids do not invent another local menu.

**Current places:**

- Shared preference foundation:
  `lib/view-preferences.ts`,
  `app/api/preferences/views/[viewKey]/route.ts`,
  `components/erp-data-grid.tsx`
- Allocator-specific preferences:
  `app/api/preferences/sales-orders-allocator/route.ts`,
  `app/(dashboard)/sales/sales-order-allocator.tsx`
- Local allocation view state:
  `app/(dashboard)/sales/sales-allocation-table.tsx`

**Recommendation:** Use `lib/view-preferences.ts` and `ERPDataGrid` as the
storage foundation, then extract the visible-column/family menu and refreshed
state display. The shared API should make local storage exceptions visible, not
silently normalize them.

## 61. Keyboard Shortcuts And Multi-Select Interaction Hints

**Proposed shared component:** `KeyboardShortcutHint`, `ShortcutText`, or
`SelectionGestureHint`.

**Pattern:** Keyboard behavior and shortcut display exist in several places, but
copy and rendering are not standardized. The pricing schedule picker explains
Ctrl/Cmd and Shift selection inline, the sidebar owns a command-style shortcut,
and menu primitives expose shortcut slots that are barely adopted.

**Current places:**

- Sidebar shortcut behavior:
  `components/ui/sidebar.tsx`
- Navigation modifier-key handling:
  `components/navigation-pending.tsx`
- Multi-select picker instructions:
  `app/(dashboard)/sales/pricing-schedule-form.tsx`
- Menu shortcut primitives:
  `components/ui/dropdown-menu.tsx`,
  `components/ui/menubar.tsx`

**Recommendation:** Add a very small hint renderer before introducing a full
shortcut registry. Standardize how Ctrl/Cmd/Shift gestures are named, where they
appear, and whether they belong in tooltip copy, muted helper text, or menu
shortcut slots.

## 62. Native Form Element Escape Hatches

**Proposed shared component:** no new primitive by default; route-level uses
should move through the existing shadcn `Input`, `Select`, `Checkbox`, or the
ERP field wrappers unless a low-level primitive explicitly requires native
markup.

**Pattern:** A final scan for raw `<input>` and `<select>` usage shows a few
route and dialog surfaces bypassing the design-system primitives. Some base
components are expected to render native elements internally, but page-level
usage creates unreviewed density, focus, validation, and disabled-state drift.

**Current places:**

- Expected low-level native wrappers:
  `components/ui/input.tsx`,
  `components/ui/table.tsx`,
  `components/erp-data-grid.tsx`,
  `components/editable-line-data-grid.tsx`
- Route/dialog escape hatches:
  `components/editable-lines.tsx`,
  `components/card-page/variant-configuration-dialog.tsx`,
  `components/card-page/copy-bom-dialog.tsx`,
  `app/(dashboard)/sales/sales-allocation-table.tsx`,
  `app/(dashboard)/purchasing/purchase-order-card.tsx`

**Recommendation:** Audit every route/dialog-level native control before
implementing field cleanup. Keep native markup only inside shared primitives or
where the browser behavior is intentionally required; otherwise use the
documented form/select/input components so focus rings, sizing, error copy, and
disabled states stay consistent.

## Recommended Cleanup Order

1. Shared dashboard/page shells: high visual payoff, low domain risk.
2. Card-page and settings panel primitive ownership.
3. Read-only table, compact table, and compact metric table primitives.
4. Status label/block metadata plus attribute, access, and permission tags.
5. Address/entity/select/date field consolidation: reduces form divergence.
6. Native form escape hatch audit.
7. Form field and validation wrappers.
8. Option-row controls, save-status indicators, and shared notice/error surfaces.
9. Search/filter/pagination toolbar primitives.
10. Bulk selection/action and reorder/priority controls.
11. Grid column/cell helpers: improves list consistency without changing domain
   behavior.
12. View preferences, column visibility, and keyboard shortcut hints.
13. Button/action, print action, and confirmation primitives.
14. Loading/empty/dialog state primitives.
15. Large entity-picker dialog frame and selection affordances.
16. Metrics, chart cards, progress bars, timelines, and legends.
17. Secondary navigation/tabs.
18. Standalone result/utility pages.
19. Local duplicate shared-utility cleanup.
20. Attachments and clipboard/copy affordances.
21. Settings rows, integration provider-card, and import-preview primitives.
22. Sales allocation matrix extraction.
23. Generated document/PDF primitives.
24. Email template primitives.
25. Under-adopted shared primitive promotion/deletion.
26. CSS module, inline-style, inventory-visual, and unclassified imported
    primitive audit.

## Follow-Up Audit Gaps

This pass was static and code-based. Before implementation, a future agent should
open the app with Paonia data and compare the largest surfaces visually:

- Sales orders list and detail card
- Manufacturing orders list and detail card
- Purchase order card
- Customer/supplier cards
- Inventory item/product/material cards
- Stocktake detail
- Settings integrations/reports/agent access
- Xero import flow
- Allocation table and allocator

The sales allocation CSS modules likely contain additional reusable allocation
matrix controls that need a dedicated second pass.
