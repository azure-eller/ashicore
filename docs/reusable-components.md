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
- `PurchaseOrderCard` — `app/(dashboard)/purchasing/purchase-order-card.tsx`
- `ManufacturingOrderCard` — `app/(dashboard)/manufacturing/orders/[id]/manufacturing-order-card.tsx`

## Card Building Blocks

- `CardField`, `CardReadOnlyValue`, `CardTextField`, `CardNumberField`, `CardSelectField`, and `CardCheckboxField` — `components/card-page/card-field.tsx`
  - Field wrappers default to card underline/density styling. Use `controlStyle="dialog"` when reusing them inside dialogs that should keep standard dialog control chrome.
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
- `MutableLines` / `ManagedEditableLines` / `FixedEditableLines` / `ReadOnlyLines` — `components/editable-lines.tsx`
- `EditableLineDataGrid` — `components/editable-line-data-grid.tsx` (low-level engine; prefer the named `*Lines` wrappers)
- `AgGridDateCellEditor` — `components/ag-grid-date-cell-editor.tsx`

## Core Feedback

- `AutosaveStatus` — `components/autosave-status.tsx`
- `StatusBadge` — `components/status-badge.tsx`
- `ConfiguredBadge` — `components/configured-badge.tsx` (small config-driven badge maps, with optional fallback for unknown statuses)
- `SelectionCountBadge` — `components/selection-count-badge.tsx`
- `FulfillmentStatusBlock` — `components/fulfillment-status-block.tsx`
- `StatusDetailMenuTable` — `components/status-detail-menu-table.tsx`
- `EmptyState` — `components/empty-state.tsx`
- `ProgressMeter` — `components/progress-meter.tsx`
- `NoticePanel` — `components/notice-panel.tsx`
- `StatusLabel` — `components/ui/status-label.tsx`
- `StatusBlock` — `components/ui/status-block.tsx`
- `StatusRibbon` — `components/ui/status-ribbon.tsx`
- `AccountingSyncStatus` — `components/accounting-sync-status.tsx`
- `DisabledTooltipButton` — `components/disabled-tooltip-button.tsx`
- `DetailPageActions` — `components/detail-page-actions.tsx`

## Core Pickers

- `AddressFields` — `components/address-fields.tsx`
- `AddressBookFields` — `components/address-book-fields.tsx`
- `InventoryItemCombobox` — `components/inventory-item-combobox.tsx`
- `EntityCombobox` — `components/entity-combobox.tsx`
- `ComboboxCreateLinks` — `components/combobox-create-links.tsx`

## Core Display

- `DateTimeText` — `components/date-time-text.tsx`
- `QuantityWithUnit` — `components/quantity-with-unit.tsx`
- `AttributeBadges` — `components/attribute-badges.tsx`
- `TooltipHeader` — `components/tooltip-header.tsx`
- `TableFrame`, `FramedTable`, `FramedTableHead`, `FramedTableBody`, `FramedTableRow`, `FramedTableHeaderCell`, `FramedTableCell`, `FramedTableEmptyRow` — `components/table-frame.tsx`
- `ListFrame` / `ListFrameItem` / `SelectableListFrameItem` — `components/list-frame.tsx`
- `InsetPanel` — `components/inset-panel.tsx`
- `SurfacePanel` — `components/surface-panel.tsx`
- `ProviderIconFrame` — `components/provider-icon-frame.tsx`
- `MetricTile` — `components/metric-tile.tsx` (default and compact density)
- `AttachmentListItem` — `components/attachment-list.tsx`
- `FileDropzone` — `components/file-dropzone.tsx`

## Inventory Visuals

- `ItemToken` — `components/inventory-visuals/item-token.tsx`
- `ItemTokenStack` — `components/inventory-visuals/item-token-stack.tsx`
- `ItemStackPreview` — `components/inventory-visuals/item-stack-preview.tsx`
- `ItemSprite` — `components/inventory-visuals/item-sprite.tsx`
- `InventoryVisualLegend` — `components/inventory-visuals/legend.tsx`
- `inferItemVisual` — `components/inventory-visuals/infer-item-visual.ts`
- `InventoryVisualPanel` / `InventoryVisualCell` — `components/inventory-visuals/visual-panel.tsx`

## Manufacturing

- `LotStrategyChip` — `components/manufacturing/lot-strategy-chip.tsx`
- `useMoSaveStatus` — `components/manufacturing/use-mo-save-status.ts`

## Shell And Navigation

- `DashboardModuleShell` — `components/dashboard-shell.tsx`
- `DashboardRouteLoading` — `components/dashboard-route-loading.tsx`
- `DataTableLoading` — `components/data-table-loading.tsx`
- `NavigationPendingProvider`, `NavigationLink`, `DashboardNavigationContent` — `components/navigation-pending.tsx`
- `DashboardTopNav` — `components/dashboard-top-nav.tsx`
- `SettingsPanel`, `SettingsPanelHeader`, `SettingsPanelSection`, `SettingsPanelActionRow`, `SettingsRows`, `SettingsKeyValueRow` — `components/settings-panel.tsx`

## Older Secondary Patterns

- `CreatePageShell`, `CreatePageHeader`, `CreatePageGrid`, `CreateSection`, `CreateSidebarCard` — `components/create-page.tsx`
- `SortableReorder`, `SortableDragHandle` — `components/sortable-reorder.tsx`
- `SortableHeader` — `components/sortable-header.tsx`
- `FilterableHeader` — `components/filterable-header.tsx`
- `DataTableStatusFilter` — `components/data-table-status-filter.tsx`
- `WorkflowStatusFilter` — `components/workflow-status-filter.tsx`
- `SegmentedCountFilter` — `components/segmented-count-filter.tsx`
