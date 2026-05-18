"use client";

import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  TooltipModule,
  themeQuartz,
  type ColDef,
  type ColGroupDef,
  type FirstDataRenderedEvent,
  type GridReadyEvent,
  type GetRowIdParams,
  type IRowNode,
  type RowDragEndEvent,
  type RowClassRules,
  type RowHeightParams,
  type SortChangedEvent,
  type SelectionChangedEvent,
} from "ag-grid-community";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import styles from "./erp-data-grid.module.css";

ModuleRegistry.registerModules([AllCommunityModule, TooltipModule]);

const erpGridTheme = themeQuartz.withParams({
  accentColor: "var(--color-accent)",
  backgroundColor: "var(--color-surface)",
  borderColor: "var(--color-line)",
  browserColorScheme: "light",
  cellHorizontalPadding: 10,
  cellTextColor: "var(--color-ink)",
  dataBackgroundColor: "var(--color-surface)",
  foregroundColor: "var(--color-ink)",
  headerBackgroundColor: "var(--color-surface-sunk)",
  headerColumnBorder: true,
  headerColumnResizeHandleColor: "var(--color-line)",
  headerTextColor: "var(--color-muted)",
  oddRowBackgroundColor: "var(--color-surface-alt)",
  rowBorder: true,
  rowHoverColor: "var(--color-accent-soft)",
  selectedRowBackgroundColor: "var(--color-accent-soft)",
  tooltipBackgroundColor: "var(--color-surface)",
  tooltipBorder: "1px solid var(--color-line)",
  tooltipTextColor: "var(--color-ink)",
  wrapperBorderRadius: 0,
});

export type ERPDataGridProps<TData extends { id: string }> = {
  rows: TData[];
  columns: Array<ColDef<TData> | ColGroupDef<TData>>;
  pinnedTopRows?: TData[];
  pinnedBottomRows?: TData[];
  getRowId?: (row: TData) => string;
  height?: string | number;
  rowHeight?: number;
  headerHeight?: number;
  groupHeaderHeight?: number;
  defaultColDef?: ColDef<TData>;
  emptyMessage?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchAriaLabel?: string;
  enableQuickFilter?: boolean;
  toolbarContent?: ReactNode;
  actions?: ReactNode;
  className?: string;
  enableRowSelection?: boolean;
  isRowSelectable?: (row: TData) => boolean;
  onSelectionChange?: (rows: TData[]) => void;
  enableManagedRowDrag?: boolean;
  suppressMoveWhenRowDragging?: boolean;
  onManagedRowDragReorder?: (rows: TData[]) => void;
  onRowDragEnd?: (event: RowDragEndEvent<TData>) => void;
  onSortChange?: (hasActiveSort: boolean) => void;
  resetRowDataOnUpdate?: boolean;
  columnHoverHighlight?: boolean;
  rowClassRules?: RowClassRules<TData>;
  isFullWidthRow?: (row: TData) => boolean;
  fullWidthCellRenderer?: (row: TData) => ReactNode;
  getRowHeight?: (row: TData) => number | undefined | null;
  onGridReady?: (event: GridReadyEvent<TData>) => void;
  onFirstDataRendered?: (event: FirstDataRenderedEvent<TData>) => void;
};

function arraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;

  return left.every((value, index) => value === right[index]);
}

function hasSameUniqueMembers(left: string[], right: string[]) {
  if (left.length !== right.length) return false;

  const leftSet = new Set(left);
  if (leftSet.size !== left.length) return false;

  return right.every((value) => leftSet.has(value));
}

function getResolvedRowId<TData extends { id: string }>(
  row: TData,
  getRowId?: (row: TData) => string
) {
  return getRowId ? getRowId(row) : row.id;
}

function buildRowsFromDropTarget<TData extends { id: string }>(
  sourceRows: TData[],
  event: RowDragEndEvent<TData>,
  getRowId?: (row: TData) => string
) {
  const drop = event.rowsDrop;
  if (
    !drop?.allowed ||
    !drop.target?.data ||
    drop.position === "none" ||
    drop.position === "inside"
  ) {
    return null;
  }

  const draggedIds = new Set(
    drop.rows
      .map((node) =>
        node.data ? getResolvedRowId(node.data, getRowId) : null
      )
      .filter((id): id is string => id != null)
  );
  if (draggedIds.size === 0) {
    return null;
  }

  const targetId = getResolvedRowId(drop.target.data, getRowId);
  if (draggedIds.has(targetId)) {
    return null;
  }

  const draggedRows = sourceRows.filter((row) =>
    draggedIds.has(getResolvedRowId(row, getRowId))
  );
  const remainingRows = sourceRows.filter(
    (row) => !draggedIds.has(getResolvedRowId(row, getRowId))
  );
  const targetIndex = remainingRows.findIndex(
    (row) => getResolvedRowId(row, getRowId) === targetId
  );

  if (targetIndex < 0 || draggedRows.length !== draggedIds.size) {
    return null;
  }

  const insertIndex =
    drop.position === "above" ? targetIndex : targetIndex + 1;

  return [
    ...remainingRows.slice(0, insertIndex),
    ...draggedRows,
    ...remainingRows.slice(insertIndex),
  ];
}

export function ERPDataGrid<TData extends { id: string }>({
  rows,
  columns,
  pinnedTopRows,
  pinnedBottomRows,
  getRowId,
  height = "calc(100dvh - 10.75rem)",
  rowHeight = 45,
  headerHeight = 45,
  groupHeaderHeight,
  defaultColDef: defaultColDefOverrides,
  emptyMessage = "No rows found.",
  searchValue,
  onSearchChange,
  searchAriaLabel = "Search rows",
  enableQuickFilter = true,
  toolbarContent,
  actions,
  className,
  enableRowSelection = false,
  isRowSelectable,
  onSelectionChange,
  enableManagedRowDrag = false,
  suppressMoveWhenRowDragging = false,
  onManagedRowDragReorder,
  onRowDragEnd,
  onSortChange,
  resetRowDataOnUpdate = false,
  columnHoverHighlight = false,
  rowClassRules,
  isFullWidthRow,
  fullWidthCellRenderer,
  getRowHeight,
  onGridReady,
  onFirstDataRendered,
}: ERPDataGridProps<TData>) {
  const managedRowDragStateRef = useRef({
    enableManagedRowDrag,
    getRowId,
    onManagedRowDragReorder,
    rows,
    searchValue,
  });
  const managedRowDragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const defaultColDef = useMemo<ColDef<TData>>(
    () => ({
      minWidth: 88,
      resizable: true,
      sortable: true,
      suppressHeaderMenuButton: true,
      ...defaultColDefOverrides,
    }),
    [defaultColDefOverrides]
  );
  const rowSelection = useMemo(
    () =>
      enableRowSelection
        ? {
            mode: "multiRow" as const,
            checkboxes: true,
            headerCheckbox: true,
            enableClickSelection: false,
            selectAll: "filtered" as const,
          }
        : undefined,
    [enableRowSelection]
  );
  const selectionColumnDef = useMemo<ColDef>(
    () => ({
      width: 38,
      minWidth: 42,
      maxWidth: 48,
      resizable: false,
      sortable: false,
      suppressMovable: true,
    }),
    []
  );
  const gridStyle = useMemo<CSSProperties>(
    () => ({
      height,
      minHeight: typeof height === "number" ? undefined : "320px",
    }),
    [height]
  );

  useEffect(() => {
    managedRowDragStateRef.current = {
      enableManagedRowDrag,
      getRowId,
      onManagedRowDragReorder,
      rows,
      searchValue,
    };
  }, [enableManagedRowDrag, getRowId, onManagedRowDragReorder, rows, searchValue]);

  useEffect(
    () => () => {
      if (managedRowDragTimeoutRef.current != null) {
        clearTimeout(managedRowDragTimeoutRef.current);
      }
    },
    []
  );

  const getId = (row: TData) => getResolvedRowId(row, getRowId);

  const handleRowDragEnd = (event: RowDragEndEvent<TData>) => {
    onRowDragEnd?.(event);

    if (!onManagedRowDragReorder) {
      return;
    }

    if (managedRowDragTimeoutRef.current != null) {
      clearTimeout(managedRowDragTimeoutRef.current);
    }

    const sourceRows = rows;
    const sourceIds = sourceRows.map(getId);

    managedRowDragTimeoutRef.current = setTimeout(() => {
      managedRowDragTimeoutRef.current = null;

      if (event.api.isDestroyed()) {
        return;
      }

      const latestState = managedRowDragStateRef.current;
      const latestSourceIds = latestState.rows.map((row) =>
        getResolvedRowId(row, latestState.getRowId)
      );
      if (
        !latestState.enableManagedRowDrag ||
        !arraysEqual(latestSourceIds, sourceIds) ||
        latestState.searchValue?.trim()
      ) {
        return;
      }

      const hasActiveSort = event.api
        .getColumnState()
        .some((column) => column.sort != null);
      if (hasActiveSort || event.api.isAnyFilterPresent()) {
        return;
      }

      const orderedRows: TData[] = [];
      event.api.forEachNodeAfterFilterAndSort((node) => {
        if (node.data) {
          orderedRows.push(node.data);
        }
      });

      const nextIds = orderedRows.map((row) =>
        getResolvedRowId(row, latestState.getRowId)
      );
      if (
        nextIds.length === sourceIds.length &&
        hasSameUniqueMembers(nextIds, sourceIds) &&
        !arraysEqual(nextIds, sourceIds)
      ) {
        latestState.onManagedRowDragReorder?.(orderedRows);
        return;
      }

      const dropTargetRows = buildRowsFromDropTarget(
        sourceRows,
        event,
        latestState.getRowId
      );
      if (!dropTargetRows) {
        return;
      }

      const dropTargetIds = dropTargetRows.map((row) =>
        getResolvedRowId(row, latestState.getRowId)
      );
      if (
        dropTargetIds.length !== sourceIds.length ||
        !hasSameUniqueMembers(dropTargetIds, sourceIds) ||
        arraysEqual(dropTargetIds, sourceIds)
      ) {
        return;
      }

      latestState.onManagedRowDragReorder?.(dropTargetRows);
    }, 0);
  };

  return (
    <section className={cn("space-y-3", styles.root, className)}>
      {(onSearchChange || toolbarContent || actions) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {onSearchChange && (
              <Input
                value={searchValue ?? ""}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search..."
                aria-label={searchAriaLabel}
                className="w-full sm:w-64"
              />
            )}
            {toolbarContent}
          </div>
          {actions && (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </div>
      )}
      <div
        data-slot="erp-data-grid"
        className={cn(
          "ashicore-grid min-w-0 overflow-hidden rounded-(--radius-none) border",
          styles.grid
        )}
        style={gridStyle}
      >
        <AgGridReact<TData>
          rowData={rows}
          columnDefs={columns}
          pinnedTopRowData={pinnedTopRows}
          pinnedBottomRowData={pinnedBottomRows}
          defaultColDef={defaultColDef}
          getRowId={({ data }: GetRowIdParams<TData>) =>
            getRowId ? getRowId(data) : data.id
          }
          resetRowDataOnUpdate={resetRowDataOnUpdate}
          theme={erpGridTheme}
          rowHeight={rowHeight}
          headerHeight={headerHeight}
          groupHeaderHeight={groupHeaderHeight}
          tooltipShowDelay={300}
          tooltipSwitchShowDelay={100}
          tooltipHideDelay={10000}
          tooltipShowMode="standard"
          columnHoverHighlight={columnHoverHighlight}
          quickFilterText={enableQuickFilter ? searchValue : undefined}
          rowClassRules={rowClassRules}
          isFullWidthRow={
            isFullWidthRow
              ? (params: { rowNode: IRowNode<TData> }) =>
                  params.rowNode.data ? isFullWidthRow(params.rowNode.data) : false
              : undefined
          }
          fullWidthCellRenderer={
            fullWidthCellRenderer
              ? (params: { data: TData | undefined }) =>
                  params.data ? fullWidthCellRenderer(params.data) : null
              : undefined
          }
          getRowHeight={
            getRowHeight
              ? (params: RowHeightParams<TData>) =>
                  params.data ? getRowHeight(params.data) ?? null : null
              : undefined
          }
          rowSelection={rowSelection}
          isRowSelectable={
            isRowSelectable
              ? (node: IRowNode<TData>) =>
                  node.data ? isRowSelectable(node.data) : false
              : undefined
          }
          selectionColumnDef={enableRowSelection ? selectionColumnDef : undefined}
          rowDragManaged={enableManagedRowDrag}
          suppressMoveWhenRowDragging={suppressMoveWhenRowDragging}
          suppressRowDrag={
            onManagedRowDragReorder ? !enableManagedRowDrag : undefined
          }
          suppressColumnMoveAnimation
          rowDragText={(params) => params.defaultTextValue}
          noRowsOverlayComponent={() => (
            <span className="text-sm text-muted-foreground">{emptyMessage}</span>
          )}
          onSelectionChanged={(event: SelectionChangedEvent<TData>) => {
            onSelectionChange?.(event.api.getSelectedRows());
          }}
          onGridReady={onGridReady}
          onFirstDataRendered={onFirstDataRendered}
          onRowDragEnd={handleRowDragEnd}
          onSortChanged={(event: SortChangedEvent<TData>) => {
            onSortChange?.(
              event.api.getColumnState().some((column) => column.sort != null)
            );
          }}
        />
      </div>
    </section>
  );
}

export type { ColDef, ColGroupDef };
