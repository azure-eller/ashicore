---
read_when:
  - Before creating a React component
---

# Reusable Components

## Entity Cards

- `ProductCard` — `app/(dashboard)/inventory/products/[id]/product-card.tsx`
- `MaterialCard` — `app/(dashboard)/inventory/materials/[id]/material-card.tsx`
- `OrderCard` — `app/(dashboard)/sales/orders/[id]/order-card.tsx`
- `CustomerCard` — `app/(dashboard)/sales/customer-card.tsx`
- `PurchaseOrderForm` — `app/(dashboard)/purchasing/purchase-order-form.tsx`
- `ManufacturingOrderCard` — `app/(dashboard)/manufacturing/orders/[id]/manufacturing-order-card.tsx`

## Card Building Blocks

- `CardPageHeader` — `components/card-page/card-page-header.tsx`
- `CardTabs` — `components/card-page/card-tabs.tsx`
- `CardPageTwoColumn` — `components/card-page/card-page-two-column.tsx`
- `ActiveVariantSelect` — `components/card-page/active-variant-select.tsx`
- `VariantTable` — `components/card-page/variant-table.tsx`
- `VariantConfigurationDialog` — `components/card-page/variant-configuration-dialog.tsx`
- `LotGridTab` — `components/card-page/lot-grid-tab.tsx`
- `OperationCostEditor` — `components/card-page/operation-cost-editor.tsx`
- `CopyDialog` — `components/card-page/copy-bom-dialog.tsx`
- `GenerateBarcodesButton` — `components/card-page/generate-barcodes-button.tsx`
- `useCardSaveStatus` — `components/card-page/use-card-save-status.ts`

## Core Grids

- `ERPDataGrid` — `components/erp-data-grid.tsx`
- `ERPDataGridList` — `components/erp-data-grid-list.tsx`
- `EditableLineDataGrid` — `components/editable-line-data-grid.tsx`
- `EditableInfoGrid` — `components/editable-info-grid.tsx`
- `AgGridDateCellEditor` — `components/ag-grid-date-cell-editor.tsx`

## Core Feedback

- `AutosaveStatus` — `components/autosave-status.tsx`
- `StatusLabel` — `components/ui/status-label.tsx`
- `StatusRibbon` — `components/ui/status-ribbon.tsx`
- `AccountingSyncStatus` — `components/accounting-sync-status.tsx`
- `OperationalStateCell` — `components/operational-state-cell.tsx`
- `DisabledTooltipButton` — `components/disabled-tooltip-button.tsx`
- `DetailPageActions` — `components/detail-page-actions.tsx`

## Core Pickers

- `AddressFields` — `components/address-fields.tsx`
- `InventoryItemCombobox` — `components/inventory-item-combobox.tsx`
- `EntityCombobox` — `components/entity-combobox.tsx`
- `ComboboxCreateLinks` — `components/combobox-create-links.tsx`

## Core Display

- `DateTimeText` — `components/date-time-text.tsx`
- `QuantityWithUnit` — `components/quantity-with-unit.tsx`
- `TooltipHeader` — `components/tooltip-header.tsx`

## Inventory Visuals

- `ItemToken` — `components/inventory-visuals/item-token.tsx`
- `ItemTokenStack` — `components/inventory-visuals/item-token-stack.tsx`
- `ItemStackPreview` — `components/inventory-visuals/item-stack-preview.tsx`
- `ItemSprite` — `components/inventory-visuals/item-sprite.tsx`
- `InventoryVisualLegend` — `components/inventory-visuals/legend.tsx`
- `inferItemVisual` — `components/inventory-visuals/infer-item-visual.ts`

## Manufacturing

- `StatusPicker` — `components/manufacturing/status-picker.tsx`
- `LotStrategyChip` — `components/manufacturing/lot-strategy-chip.tsx`
- `ManufacturingIngredientLotCard` — `components/manufacturing/ingredient-lot-card.tsx`
- `useMoSaveStatus` — `components/manufacturing/use-mo-save-status.ts`

## Shell And Navigation

- `DashboardRouteLoading` — `components/dashboard-route-loading.tsx`
- `DataTableLoading` — `components/data-table-loading.tsx`
- `NavigationPendingProvider`, `NavigationLink`, `DashboardNavigationContent` — `components/navigation-pending.tsx`
- `DashboardTopNav` — `components/dashboard-top-nav.tsx`

## Older Secondary Patterns

- `CreatePageShell`, `CreatePageHeader`, `CreatePageGrid`, `CreateSection`, `CreateSidebarCard` — `components/create-page.tsx`
- `SortableReorder`, `SortableDragHandle` — `components/sortable-reorder.tsx`
- `SortableHeader` — `components/sortable-header.tsx`
- `FilterableHeader` — `components/filterable-header.tsx`
- `DataTableStatusFilter` — `components/data-table-status-filter.tsx`
