"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type Ref,
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
  type CellValueChangedEvent,
  type GridApi,
  type FirstDataRenderedEvent,
  type GridState,
  type GridStateKey,
  type GridReadyEvent,
  type GetRowIdParams,
  type IRowNode,
  type RowDragEndEvent,
  type RowClassRules,
  type RowHeightParams,
  type SortChangedEvent,
  type SelectionChangedEvent,
  type StateUpdatedEvent,
} from "ag-grid-community";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import styles from "./erp-data-grid.module.css";

ModuleRegistry.registerModules([AllCommunityModule, TooltipModule]);

export type ERPGridPersistentState = Partial<
  Pick<
    GridState,
    | "columnOrder"
    | "columnPinning"
    | "columnSizing"
    | "columnVisibility"
    | "sort"
  >
>;

const PERSISTED_GRID_STATE_IGNORED_KEYS: GridStateKey[] = [
  "aggregation",
  "cellSelection",
  "columnGroup",
  "filter",
  "focusedCell",
  "pagination",
  "pivot",
  "rowGroup",
  "rowGroupExpansion",
  "rowPinning",
  "rowSelection",
  "scroll",
  "sideBar",
  "ssrmRowGroupExpansion",
];

export const erpGridTheme = themeQuartz.withParams({
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
  searchInputRef?: Ref<HTMLInputElement>;
  searchAriaLabel?: string;
  enableQuickFilter?: boolean;
  toolbarContent?: ReactNode;
  toolbarClassName?: string;
  actions?: ReactNode;
  statusBarContent?: ReactNode;
  statusBarClassName?: string;
  gridClassName?: string;
  className?: string;
  enableRowSelection?: boolean;
  isRowSelectable?: (row: TData) => boolean;
  onSelectionChange?: (rows: TData[]) => void;
  onCellValueChanged?: (event: CellValueChangedEvent<TData>) => void;
  enableManagedRowDrag?: boolean;
  suppressMoveWhenRowDragging?: boolean;
  onManagedRowDragReorder?: (rows: TData[]) => void;
  onRowDragEnd?: (event: RowDragEndEvent<TData>) => void;
  onSortChange?: (hasActiveSort: boolean) => void;
  resetRowDataOnUpdate?: boolean;
  relaxResizableMaxWidth?: boolean;
  columnHoverHighlight?: boolean;
  rowClassRules?: RowClassRules<TData>;
  suppressColumnVirtualisation?: boolean;
  isFullWidthRow?: (row: TData) => boolean;
  fullWidthCellRenderer?: (row: TData) => ReactNode;
  getRowHeight?: (row: TData) => number | undefined | null;
  persistedGridState?: ERPGridPersistentState;
  onPersistedGridStateChange?: (state: ERPGridPersistentState) => void;
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

function pickPersistedGridState(state: GridState): ERPGridPersistentState {
  return {
    ...(state.columnOrder ? { columnOrder: state.columnOrder } : {}),
    ...(state.columnPinning ? { columnPinning: state.columnPinning } : {}),
    ...(state.columnSizing ? { columnSizing: state.columnSizing } : {}),
    ...(state.columnVisibility
      ? { columnVisibility: state.columnVisibility }
      : {}),
    ...(state.sort ? { sort: state.sort } : {}),
  };
}

function serializeGridState(state: ERPGridPersistentState | undefined) {
  return JSON.stringify(state ?? {});
}

function getGridVerticalScrollViewport(root: HTMLDivElement | null) {
  return (
    root?.querySelector<HTMLElement>(".ag-body-vertical-scroll-viewport") ??
    root?.querySelector<HTMLElement>(".ag-body-viewport") ??
    null
  );
}

function removeResizableMaxWidth<TData>(
  column: ColDef<TData> | ColGroupDef<TData>
): ColDef<TData> | ColGroupDef<TData> {
  if ("children" in column) {
    return {
      ...column,
      children: column.children.map(removeResizableMaxWidth),
    };
  }

  if (column.resizable === false || column.maxWidth == null) {
    return column;
  }

  const nextColumn = { ...column };
  delete nextColumn.maxWidth;
  return nextColumn;
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
  searchInputRef,
  searchAriaLabel = "Search rows",
  enableQuickFilter = true,
  toolbarContent,
  toolbarClassName,
  actions,
  statusBarContent,
  statusBarClassName,
  gridClassName,
  className,
  enableRowSelection = false,
  isRowSelectable,
  onSelectionChange,
  onCellValueChanged,
  enableManagedRowDrag = false,
  suppressMoveWhenRowDragging = false,
  onManagedRowDragReorder,
  onRowDragEnd,
  onSortChange,
  resetRowDataOnUpdate = false,
  relaxResizableMaxWidth = false,
  columnHoverHighlight = false,
  rowClassRules,
  suppressColumnVirtualisation = false,
  isFullWidthRow,
  fullWidthCellRenderer,
  getRowHeight,
  persistedGridState,
  onPersistedGridStateChange,
  onGridReady,
  onFirstDataRendered,
}: ERPDataGridProps<TData>) {
  const gridApiRef = useRef<GridApi<TData> | null>(null);
  const gridRootRef = useRef<HTMLDivElement | null>(null);
  const applyingPersistedGridStateRef = useRef(false);
  const lastPersistedGridStateRef = useRef(serializeGridState(persistedGridState));
  const lastVerticalScrollTopRef = useRef(0);
  const cleanupScrollListenerRef = useRef<(() => void) | null>(null);
  const managedRowDragStateRef = useRef({
    enableManagedRowDrag,
    getRowId,
    onManagedRowDragReorder,
    rows,
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
  const resizableColumns = useMemo(
    () => (relaxResizableMaxWidth ? columns.map(removeResizableMaxWidth) : columns),
    [columns, relaxResizableMaxWidth]
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
  const initialState = useMemo<GridState | undefined>(
    () =>
      persistedGridState
        ? {
            ...persistedGridState,
            partialColumnState: true,
          }
        : undefined,
    [persistedGridState]
  );

  const applyPersistedGridState = useCallback(
    (state: ERPGridPersistentState | undefined) => {
      const api = gridApiRef.current;
      if (!api || !state || api.isDestroyed()) return;

      const serialized = serializeGridState(state);
      if (serialized === lastPersistedGridStateRef.current) return;

      applyingPersistedGridStateRef.current = true;
      api.setState(
        {
          ...state,
          partialColumnState: true,
        },
        PERSISTED_GRID_STATE_IGNORED_KEYS
      );
      lastPersistedGridStateRef.current = serialized;
      window.setTimeout(() => {
        applyingPersistedGridStateRef.current = false;
      }, 0);
    },
    []
  );

  const bindVerticalScrollViewport = useCallback(() => {
    cleanupScrollListenerRef.current?.();
    cleanupScrollListenerRef.current = null;

    const viewport = getGridVerticalScrollViewport(gridRootRef.current);
    if (!viewport) return;

    lastVerticalScrollTopRef.current = viewport.scrollTop;

    const handleScroll = () => {
      lastVerticalScrollTopRef.current = viewport.scrollTop;
    };

    viewport.addEventListener("scroll", handleScroll, { passive: true });
    cleanupScrollListenerRef.current = () => {
      viewport.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    managedRowDragStateRef.current = {
      enableManagedRowDrag,
      getRowId,
      onManagedRowDragReorder,
      rows,
    };
  }, [enableManagedRowDrag, getRowId, onManagedRowDragReorder, rows]);

  useEffect(() => {
    applyPersistedGridState(persistedGridState);
  }, [applyPersistedGridState, persistedGridState]);

  useEffect(
    () => () => {
      if (managedRowDragTimeoutRef.current != null) {
        clearTimeout(managedRowDragTimeoutRef.current);
      }
      cleanupScrollListenerRef.current?.();
    },
    []
  );

  useLayoutEffect(() => {
    if (!resetRowDataOnUpdate) return;

    const api = gridApiRef.current;
    const scrollTop = lastVerticalScrollTopRef.current;
    if (!api || api.isDestroyed() || scrollTop <= 0) return;

    const restoreScroll = () => {
      if (api.isDestroyed()) return;

      const viewport = getGridVerticalScrollViewport(gridRootRef.current);
      if (!viewport) return;

      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const nextScrollTop = Math.min(scrollTop, maxScrollTop);
      if (Math.abs(viewport.scrollTop - nextScrollTop) > 1) {
        viewport.scrollTop = nextScrollTop;
        lastVerticalScrollTopRef.current = nextScrollTop;
      }
    };

    const frame = window.requestAnimationFrame(restoreScroll);

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [resetRowDataOnUpdate, rows, pinnedTopRows, pinnedBottomRows]);

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
        !arraysEqual(latestSourceIds, sourceIds)
      ) {
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

  const handleStateUpdated = (event: StateUpdatedEvent<TData>) => {
    if (
      !onPersistedGridStateChange ||
      applyingPersistedGridStateRef.current ||
      event.api.isDestroyed()
    ) {
      return;
    }

    const nextState = pickPersistedGridState(event.state);
    const serialized = serializeGridState(nextState);
    if (serialized === lastPersistedGridStateRef.current) {
      return;
    }

    lastPersistedGridStateRef.current = serialized;
    onPersistedGridStateChange(nextState);
  };

  return (
    <section className={cn("space-y-3", styles.root, className)}>
      {(onSearchChange || toolbarContent || actions) && (
        <div
          className={cn(
            "flex flex-col gap-(--space-4) sm:flex-row sm:items-center sm:justify-between",
            toolbarClassName
          )}
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-(--space-4)">
            {onSearchChange && (
              <Input
                ref={searchInputRef}
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
            <div className="flex shrink-0 items-center gap-(--space-4)">{actions}</div>
          )}
        </div>
      )}
      <div
        ref={gridRootRef}
        data-slot="erp-data-grid"
        className={cn(
          "ashicore-grid min-w-0 overflow-hidden rounded-(--radius-none) border",
          styles.grid,
          gridClassName
        )}
        style={gridStyle}
      >
        <AgGridReact<TData>
          rowData={rows}
          columnDefs={resizableColumns}
          pinnedTopRowData={pinnedTopRows}
          pinnedBottomRowData={pinnedBottomRows}
          initialState={initialState}
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
          suppressColumnVirtualisation={suppressColumnVirtualisation}
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
            <span className="text-[length:var(--text-sm)] text-muted-foreground">
              {emptyMessage}
            </span>
          )}
          onSelectionChanged={(event: SelectionChangedEvent<TData>) => {
            onSelectionChange?.(event.api.getSelectedRows());
          }}
          onCellValueChanged={onCellValueChanged}
          onGridReady={(event: GridReadyEvent<TData>) => {
            gridApiRef.current = event.api;
            applyPersistedGridState(persistedGridState);
            window.setTimeout(bindVerticalScrollViewport, 0);
            onGridReady?.(event);
          }}
          onFirstDataRendered={(event: FirstDataRenderedEvent<TData>) => {
            bindVerticalScrollViewport();
            onFirstDataRendered?.(event);
          }}
          onRowDragEnd={handleRowDragEnd}
          onStateUpdated={handleStateUpdated}
          onSortChanged={(event: SortChangedEvent<TData>) => {
            onSortChange?.(
              event.api.getColumnState().some((column) => column.sort != null)
            );
          }}
        />
      </div>
      {statusBarContent ? (
        <div
          className={cn(
            "flex h-(--height-statusbar) shrink-0 items-center gap-(--space-6) border-t border-border bg-card px-(--space-8) text-[length:var(--text-xs)] text-muted-foreground tabular-nums",
            statusBarClassName
          )}
        >
          {statusBarContent}
        </div>
      ) : null}
    </section>
  );
}

export type { ColDef, ColGroupDef };
