"use client";

import { useMemo, type CSSProperties, type ReactNode } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type GetRowIdParams,
  type RowDragEndEvent,
  type SortChangedEvent,
  type SelectionChangedEvent,
} from "ag-grid-community";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import styles from "./erp-data-grid.module.css";

ModuleRegistry.registerModules([AllCommunityModule]);

const erpGridTheme = themeQuartz.withParams({
  accentColor: "var(--primary)",
  backgroundColor: "var(--background)",
  borderColor: "var(--border)",
  browserColorScheme: "light",
  cellHorizontalPadding: 12,
  cellTextColor: "var(--foreground)",
  dataBackgroundColor: "var(--background)",
  foregroundColor: "var(--foreground)",
  headerBackgroundColor: "color-mix(in oklch, var(--muted) 45%, transparent)",
  headerColumnBorder: true,
  headerColumnResizeHandleColor: "var(--border)",
  headerTextColor: "var(--muted-foreground)",
  rowBorder: true,
  rowHoverColor: "color-mix(in oklch, var(--muted) 45%, transparent)",
  selectedRowBackgroundColor: "color-mix(in oklch, var(--primary) 8%, transparent)",
  wrapperBorderRadius: 6,
});

export type ERPDataGridProps<TData extends { id: string }> = {
  rows: TData[];
  columns: ColDef<TData>[];
  getRowId?: (row: TData) => string;
  height?: string | number;
  emptyMessage?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchAriaLabel?: string;
  toolbarContent?: ReactNode;
  actions?: ReactNode;
  className?: string;
  enableRowSelection?: boolean;
  onSelectionChange?: (rows: TData[]) => void;
  enableManagedRowDrag?: boolean;
  suppressMoveWhenRowDragging?: boolean;
  onRowDragEnd?: (event: RowDragEndEvent<TData>) => void;
  onSortChange?: (hasActiveSort: boolean) => void;
  resetRowDataOnUpdate?: boolean;
};

export function ERPDataGrid<TData extends { id: string }>({
  rows,
  columns,
  getRowId,
  height = "calc(100dvh - 10.75rem)",
  emptyMessage = "No rows found.",
  searchValue,
  onSearchChange,
  searchAriaLabel = "Search rows",
  toolbarContent,
  actions,
  className,
  enableRowSelection = false,
  onSelectionChange,
  enableManagedRowDrag = false,
  suppressMoveWhenRowDragging = false,
  onRowDragEnd,
  onSortChange,
  resetRowDataOnUpdate = false,
}: ERPDataGridProps<TData>) {
  const defaultColDef = useMemo<ColDef<TData>>(
    () => ({
      minWidth: 88,
      resizable: true,
      sortable: true,
      suppressHeaderMenuButton: true,
    }),
    []
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
        className={cn("min-w-0 overflow-hidden rounded-md border", styles.grid)}
        style={gridStyle}
      >
        <AgGridReact<TData>
          rowData={rows}
          columnDefs={columns}
          defaultColDef={defaultColDef}
          getRowId={({ data }: GetRowIdParams<TData>) =>
            getRowId ? getRowId(data) : data.id
          }
          resetRowDataOnUpdate={resetRowDataOnUpdate}
          theme={erpGridTheme}
          rowHeight={54}
          headerHeight={42}
          quickFilterText={searchValue}
          rowSelection={rowSelection}
          selectionColumnDef={enableRowSelection ? selectionColumnDef : undefined}
          rowDragManaged={enableManagedRowDrag}
          suppressMoveWhenRowDragging={suppressMoveWhenRowDragging}
          suppressCellFocus
          suppressColumnMoveAnimation
          rowDragText={(params) => params.defaultTextValue}
          noRowsOverlayComponent={() => (
            <span className="text-sm text-muted-foreground">{emptyMessage}</span>
          )}
          onSelectionChanged={(event: SelectionChangedEvent<TData>) => {
            onSelectionChange?.(event.api.getSelectedRows());
          }}
          onRowDragEnd={onRowDragEnd}
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

export type { ColDef };
