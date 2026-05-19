"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";
import { AgGridReact } from "ag-grid-react";
import {
  type CellClickedEvent,
  type CellValueChangedEvent,
  type ColDef,
  type GetRowIdParams,
  type GridApi,
  type GridReadyEvent,
  type ICellRendererParams,
  type RowDragEndEvent,
  type RowClassRules,
} from "ag-grid-community";
import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { erpGridTheme } from "./erp-data-grid";
import styles from "./erp-data-grid.module.css";

type EditableLineCellEditorParams = {
  openEditorOnStart?: boolean;
};

export type EditableLineDataGridChangeType =
  | "cell_edit_committed"
  | "row_added"
  | "row_deleted"
  | "row_reordered"
  | "blank_row_committed"
  | "initialized_blank_row";

export type EditableLineDataGridChange<TData> = {
  type: EditableLineDataGridChangeType;
  rows: TData[];
  row?: TData;
  /**
   * For `cell_edit_committed` / `blank_row_committed` changes, the colDef field
   * the user edited (e.g. `"sku"`). Useful for per-cell autosave consumers
   * that need to know which API field to PATCH.
   */
  field?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
};

export type EditableLineDataGridProps<TData> = {
  rows: TData[];
  columns: ColDef<TData>[];
  getRowId: (row: TData) => string;
  createRow: () => TData;
  onRowsChange: (
    rows: TData[],
    change: EditableLineDataGridChange<TData>
  ) => void;
  addLabel: string;
  emptyMessage?: string;
  className?: string;
  minHeight?: number | string;
  rowHeight?: number;
  headerHeight?: number;
  defaultColDef?: ColDef<TData>;
  enableReorder?: boolean;
  enableDelete?: boolean;
  /**
   * When false, the "+ Add row" button is hidden and the auto-initialized
   * blank row is suppressed. Use for list-style editable grids whose rows
   * come from elsewhere (e.g. the variant table — variants are generated
   * from option combinations, not row-add).
   */
  enableAddRow?: boolean;
  isBlankRow?: (row: TData) => boolean;
  rowHasError?: (row: TData) => boolean;
  error?: string | null;
  onGridReady?: (event: GridReadyEvent<TData>) => void;
};

function rowIdsEqual<TData>(
  left: TData[],
  right: TData[],
  getRowId: (row: TData) => string
) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((row, index) => getRowId(row) === getRowId(right[index]));
}

function DeleteCell<TData>({
  data,
  onDelete,
}: ICellRendererParams<TData> & {
  onDelete: (row: TData) => void;
}) {
  if (!data) {
    return null;
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Delete row"
      onClick={() => onDelete(data)}
    >
      <HugeiconsIcon icon={Delete02Icon} aria-hidden />
    </Button>
  );
}

function isEditableColumn<TData>(
  event: CellClickedEvent<TData>,
  colDef: ColDef<TData>
) {
  if (colDef.editable === true) {
    return true;
  }

  if (typeof colDef.editable === "function") {
    return Boolean(
      colDef.editable({
        api: event.api,
        column: event.column,
        colDef,
        context: event.context,
        data: event.data,
        node: event.node,
      })
    );
  }

  return false;
}

function shouldOpenEditorOnStart<TData>(colDef: ColDef<TData>) {
  const cellEditorParams =
    typeof colDef.cellEditorParams === "object" && colDef.cellEditorParams != null
      ? (colDef.cellEditorParams as EditableLineCellEditorParams)
      : null;
  if (
    cellEditorParams?.openEditorOnStart ||
    colDef.cellEditor === "agSelectCellEditor"
  ) {
    return true;
  }
  return false;
}

export function EditableLineDataGrid<TData>({
  rows,
  columns,
  getRowId,
  createRow,
  onRowsChange,
  addLabel,
  emptyMessage = "No rows yet.",
  className,
  minHeight,
  rowHeight = 40,
  headerHeight = 34,
  defaultColDef: defaultColDefOverrides,
  enableReorder = true,
  enableDelete = true,
  enableAddRow = true,
  isBlankRow,
  rowHasError,
  error,
  onGridReady,
}: EditableLineDataGridProps<TData>) {
  const gridApiRef = useRef<GridApi<TData> | null>(null);
  const stateRef = useRef({ rows, getRowId, onRowsChange });
  const hasInitializedBlankRowRef = useRef(false);

  useEffect(() => {
    stateRef.current = { rows, getRowId, onRowsChange };
  }, [getRowId, onRowsChange, rows]);

  useEffect(() => {
    if (!enableAddRow) return;
    if (hasInitializedBlankRowRef.current || rows.length > 0) {
      return;
    }

    hasInitializedBlankRowRef.current = true;
    const row = createRow();
    onRowsChange([row], {
      type: "initialized_blank_row",
      rows: [row],
      row,
    });
  }, [createRow, enableAddRow, onRowsChange, rows.length]);

  const emitRowsChange = useCallback(
    (nextRows: TData[], change: Omit<EditableLineDataGridChange<TData>, "rows">) => {
      onRowsChange(nextRows, { ...change, rows: nextRows });
    },
    [onRowsChange]
  );

  const handleAddRow = useCallback(() => {
    const row = createRow();
    const nextRows = [...rows, row];
    emitRowsChange(nextRows, { type: "row_added", row });

    window.requestAnimationFrame(() => {
      const firstEditableColumn = gridApiRef.current
        ?.getColumns()
        ?.find((column) => {
          const colDef = column.getColDef();
          return colDef.editable === true || typeof colDef.editable === "function";
        });

      if (!firstEditableColumn) {
        return;
      }

      gridApiRef.current?.startEditingCell({
        rowIndex: nextRows.length - 1,
        colKey: firstEditableColumn,
      });
    });
  }, [createRow, emitRowsChange, rows]);

  const handleDeleteRow = useCallback(
    (row: TData) => {
      const rowId = getRowId(row);
      const nextRows = rows.filter((current) => getRowId(current) !== rowId);
      emitRowsChange(nextRows, { type: "row_deleted", row });
    },
    [emitRowsChange, getRowId, rows]
  );

  const defaultColDef = useMemo<ColDef<TData>>(
    () => ({
      editable: false,
      minWidth: 92,
      resizable: true,
      sortable: false,
      suppressHeaderMenuButton: true,
      ...defaultColDefOverrides,
    }),
    [defaultColDefOverrides]
  );

  const actionColumns = useMemo<ColDef<TData>[]>(() => {
    const nextColumns: ColDef<TData>[] = [];

    if (enableReorder) {
      nextColumns.push({
        colId: "__drag",
        width: 42,
        minWidth: 42,
        maxWidth: 42,
        rowDrag: true,
        resizable: false,
        sortable: false,
        suppressMovable: true,
        getQuickFilterText: () => "",
      });
    }

    if (enableDelete) {
      nextColumns.push({
        colId: "__delete",
        width: 42,
        minWidth: 42,
        maxWidth: 42,
        resizable: false,
        sortable: false,
        suppressMovable: true,
        cellRenderer: (params: ICellRendererParams<TData>) => (
          <DeleteCell {...params} onDelete={handleDeleteRow} />
        ),
        getQuickFilterText: () => "",
      });
    }

    return nextColumns;
  }, [enableDelete, enableReorder, handleDeleteRow]);

  const columnDefs = useMemo<ColDef<TData>[]>(
    () => [...(enableReorder ? actionColumns.slice(0, 1) : []), ...columns, ...(enableDelete ? actionColumns.slice(enableReorder ? 1 : 0) : [])],
    [actionColumns, columns, enableDelete, enableReorder]
  );

  const rowClassRules = useMemo<RowClassRules<TData>>(
    () => ({
      "erp-editable-grid-row-error": (params) =>
        params.data ? Boolean(rowHasError?.(params.data)) : false,
    }),
    [rowHasError]
  );

  const gridStyle = useMemo<CSSProperties>(
    () => ({
      minHeight,
    }),
    [minHeight]
  );

  const handleCellValueChanged = useCallback(
    (event: CellValueChangedEvent<TData>) => {
      if (!event.data) {
        return;
      }

      const latest = stateRef.current;
      const editedId = latest.getRowId(event.data);
      const nextRows = latest.rows.map((row) =>
        latest.getRowId(row) === editedId ? { ...event.data } : row
      );
      const editedRow = nextRows.find((row) => latest.getRowId(row) === editedId);
      let finalRows = nextRows;
      let type: EditableLineDataGridChangeType = "cell_edit_committed";

      if (
        editedRow &&
        isBlankRow &&
        !isBlankRow(editedRow) &&
        finalRows.every((row) => !isBlankRow(row))
      ) {
        finalRows = [...finalRows, createRow()];
        type = "blank_row_committed";
      }

      latest.onRowsChange(finalRows, {
        type,
        rows: finalRows,
        row: editedRow,
        field: event.colDef.field ?? null,
        oldValue: event.oldValue,
        newValue: event.newValue,
      });
    },
    [createRow, isBlankRow]
  );

  const handleRowDragEnd = useCallback((event: RowDragEndEvent<TData>) => {
    const latest = stateRef.current;
    const nextRows: TData[] = [];

    event.api.forEachNode((node) => {
      if (node.data) {
        nextRows.push(node.data);
      }
    });

    if (rowIdsEqual(latest.rows, nextRows, latest.getRowId)) {
      return;
    }

    latest.onRowsChange(nextRows, {
      type: "row_reordered",
      rows: nextRows,
    });
  }, []);

  const handleCellClicked = useCallback((event: CellClickedEvent<TData>) => {
    if (event.rowIndex == null || !event.data) {
      return;
    }

    const colDef = event.column.getColDef();
    if (!isEditableColumn(event, colDef)) {
      return;
    }

    event.api.startEditingCell({
      rowIndex: event.rowIndex,
      colKey: event.column,
      key: shouldOpenEditorOnStart(colDef) ? "Enter" : undefined,
    });
  }, []);

  return (
    <div className={cn("flex min-w-0 flex-col gap-(--space-4)", className)}>
      <div
        data-slot="editable-line-data-grid"
        className={cn(
          "ashicore-grid min-w-0 overflow-hidden rounded-(--radius-none) border",
          styles.grid,
          styles.editableGrid
        )}
        style={gridStyle}
      >
        <AgGridReact<TData>
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={({ data }: GetRowIdParams<TData>) => getRowId(data)}
          theme={erpGridTheme}
          rowHeight={rowHeight}
          headerHeight={headerHeight}
          domLayout="autoHeight"
          suppressClickEdit
          stopEditingWhenCellsLoseFocus
          invalidEditValueMode="revert"
          rowDragManaged={enableReorder}
          suppressMoveWhenRowDragging
          suppressColumnMoveAnimation
          rowClassRules={rowClassRules}
          noRowsOverlayComponent={() => (
            <span className="text-[length:var(--text-sm)] text-muted-foreground">
              {emptyMessage}
            </span>
          )}
          onGridReady={(event) => {
            gridApiRef.current = event.api;
            onGridReady?.(event);
          }}
          onCellClicked={handleCellClicked}
          onCellValueChanged={handleCellValueChanged}
          onRowDragEnd={handleRowDragEnd}
        />
      </div>

      {error ? <FieldError>{error}</FieldError> : null}

      {enableAddRow ? (
        <div>
          <Button type="button" variant="outline" onClick={handleAddRow}>
            <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
            {addLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export type { ColDef };
