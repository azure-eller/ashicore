"use client";

import {
  Fragment,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type BuiltInFilterFn,
  type ColumnDef,
  type ColumnFiltersState,
  type ExpandedState,
  type FilterFn,
  type Row,
  type RowSelectionState,
  type SortingState,
  type Table as TanStackTable,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Add01Icon,
  ArrowDown01Icon,
  DragDropVerticalIcon,
  MoreVerticalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiJson } from "@/lib/client/api";
import { cn } from "@/lib/utils";

type DeleteActionConfig = {
  endpoint: string;
  invalidateQueryKeys: QueryKey[];
  defaultErrorMessage: string;
  confirmTitle: (count: number) => string;
  confirmDescription: (count: number) => string;
  pendingLabel?: string;
  trackDeletingRows?: boolean;
  idempotencyKey?: string;
};

type AddAction = {
  label: string;
  href: string;
};

type SelectedActionHelpers = {
  clearSelection: () => void;
};

type SelectedAction<TData extends { id: string }> = {
  label: string;
  onSelect: (rows: TData[], helpers: SelectedActionHelpers) => void;
  disabled?: boolean | ((rows: TData[]) => boolean);
  isPending?: boolean;
  variant?: "default" | "destructive";
};

type DashboardColumnMeta = {
  className?: string;
};

type ToolbarRenderContext<TData extends { id: string }> = {
  table: TanStackTable<TData>;
};

type RowReorderConfig<TData extends { id: string }> = {
  onReorder: (rows: TData[]) => void | Promise<void>;
  disabled?: boolean;
  enabled?: (table: TanStackTable<TData>) => boolean;
};

type DashboardDataTableProps<TData extends { id: string }> = {
  columns: ColumnDef<TData>[];
  data?: TData[];
  initialData: TData[];
  queryKey: QueryKey;
  queryFn?: () => Promise<TData[]>;
  enableRowSelection?: boolean | ((row: Row<TData>) => boolean);
  searchAriaLabel: string;
  addHref?: string;
  addAriaLabel?: string;
  emptyMessage: string;
  deleteAction?: DeleteActionConfig;
  selectedActions?: SelectedAction<TData>[];
  toolbarContent?: ReactNode | ((context: ToolbarRenderContext<TData>) => ReactNode);
  addActions?: AddAction[];
  tableClassName?: string;
  tableWrapperClassName?: string;
  getRowCanExpand?: (row: Row<TData>) => boolean;
  renderExpandedRow?: (row: Row<TData>) => React.ReactNode;
  getSubRows?: (row: TData) => TData[] | undefined;
  subRowClassName?: string;
  globalFilterFn?: FilterFn<TData> | BuiltInFilterFn;
  onRowClick?: (row: TData) => void;
  initialSorting?: SortingState;
  initialColumnFilters?: ColumnFiltersState;
  columnVisibility?: VisibilityState;
  errorMessage?: string | null;
  stickyHeader?: boolean;
  verticalColumnBorders?: boolean;
  rowReorder?: RowReorderConfig<TData>;
};

type RowReorderHandleContextValue = {
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
  disabled: boolean;
};

const RowReorderHandleContext =
  createContext<RowReorderHandleContextValue | null>(null);

function isInteractiveRowTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    target.closest(
      "a,button,input,select,textarea,label,[role='button'],[role='checkbox'],[role='menuitem'],[data-row-click-ignore='true']"
    ) != null
  );
}

export function DashboardDataTable<TData extends { id: string }>({
  columns,
  data: controlledData,
  initialData,
  queryKey,
  queryFn,
  enableRowSelection,
  searchAriaLabel,
  addHref,
  addAriaLabel,
  emptyMessage,
  deleteAction,
  selectedActions,
  toolbarContent,
  addActions,
  tableClassName,
  tableWrapperClassName,
  getRowCanExpand: getRowCanExpandProp,
  renderExpandedRow,
  getSubRows: getSubRowsProp,
  subRowClassName,
  globalFilterFn,
  onRowClick,
  initialSorting,
  initialColumnFilters,
  columnVisibility,
  errorMessage,
  stickyHeader = true,
  verticalColumnBorders = false,
  rowReorder,
}: DashboardDataTableProps<TData>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const queryColumnFilters = useMemo(
    () => getColumnFiltersFromSearchParams(searchParams, columns, initialColumnFilters),
    [columns, initialColumnFilters, searchParams]
  );
  const [sorting, setSorting] = useState<SortingState>(initialSorting ?? []);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(
    queryColumnFilters
  );
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const { data: queriedData = initialData } = useQuery<TData[]>({
    queryKey,
    queryFn: queryFn ?? (() => Promise.resolve(initialData)),
    initialData,
    enabled: queryFn != null,
  });
  const data = controlledData ?? queriedData;

  useEffect(() => {
    setColumnFilters(queryColumnFilters);
  }, [queryColumnFilters]);

  const deleteMutation = useMutation<void, Error, string[]>({
    mutationFn: async (ids) => {
      if (!deleteAction) {
        throw new Error("Delete action is not configured.");
      }

      await apiJson<void>(deleteAction.endpoint, {
        method: "DELETE",
        idempotencyKey: deleteAction.idempotencyKey,
        body: { ids },
        fallbackError: deleteAction.defaultErrorMessage,
      });
    },
    onMutate: (ids) => {
      setFormError(null);

      if (deleteAction?.trackDeletingRows) {
        setDeletingIds(new Set(ids));
      }
    },
    onSuccess: async () => {
      if (deleteAction) {
        await Promise.all(
          deleteAction.invalidateQueryKeys.map((invalidateKey) =>
            queryClient.invalidateQueries({ queryKey: invalidateKey })
          )
        );
      }

      setFormError(null);
      setConfirmDeleteOpen(false);
      setPendingDeleteIds([]);
      setRowSelection({});
      router.refresh();
    },
    onError: (error) => {
      setFormError(error.message);
    },
    onSettled: () => {
      setDeletingIds(new Set());
    },
  });

  const rowSelectionConfig =
    enableRowSelection ?? (deleteAction != null || selectedActions != null);
  const enableSelection = rowSelectionConfig !== false;
  const hasExpansion = renderExpandedRow != null || getSubRowsProp != null;
  // TanStack Table returns instance methods that React Compiler treats as incompatible.
  // Centralizing the hook here keeps the warning scoped to the shared table shell.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getRowId: (row) => row.id,
    enableRowSelection: rowSelectionConfig,
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    globalFilterFn: globalFilterFn ?? "includesString",
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    filterFromLeafRows: true,
    ...(hasExpansion
      ? {
          getExpandedRowModel: getExpandedRowModel(),
          getRowCanExpand: getRowCanExpandProp,
          onExpandedChange: setExpanded,
          ...(getSubRowsProp ? { getSubRows: getSubRowsProp, paginateExpandedRows: false } : {}),
        }
      : {}),
    initialState: {
      pagination: { pageSize: 25 },
    },
    state: {
      sorting,
      rowSelection,
      globalFilter,
      columnFilters,
      ...(columnVisibility ? { columnVisibility } : {}),
      ...(hasExpansion ? { expanded } : {}),
    },
  });

  const selectedCount = enableSelection
    ? table.getFilteredSelectedRowModel().rows.length
    : 0;
  const selectedRows = enableSelection
    ? table.getFilteredSelectedRowModel().rows.map((row) => row.original)
    : [];
  const selectionActions = selectedActions ?? [];
  const hasSelectionMenu = deleteAction != null || selectionActions.length > 0;
  const allSelectionActionsDisabled =
    selectionActions.length > 0 &&
    selectionActions.every((action) =>
      typeof action.disabled === "function"
        ? action.disabled(selectedRows)
        : action.disabled === true
    );
  const anySelectionActionPending = selectionActions.some(
    (action) => action.isPending === true
  );
  const rowModel = table.getRowModel();
  const prePaginationRows = table.getPrePaginationRowModel().rows;
  const reorderEnabled =
    rowReorder != null &&
    rowReorder.disabled !== true &&
    (rowReorder.enabled?.(table) ?? true);
  const sortableRowIds = reorderEnabled ? rowModel.rows.map((row) => row.id) : [];
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    if (!rowReorder || rowReorder.disabled === true) return;

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const fromIndex = prePaginationRows.findIndex((row) => row.id === active.id);
    const toIndex = prePaginationRows.findIndex((row) => row.id === over.id);

    if (fromIndex < 0 || toIndex < 0) return;

    const reorderedRows = arrayMove(prePaginationRows, fromIndex, toIndex);
    void rowReorder.onReorder(reorderedRows.map((row) => row.original));
  }

  const tableBody = reorderEnabled ? (
    <SortableContext
      items={sortableRowIds}
      strategy={verticalListSortingStrategy}
    >
      <DashboardTableBody
        table={table}
        rows={rowModel.rows}
        deletingIds={deletingIds}
        emptyMessage={emptyMessage}
        globalFilter={globalFilter}
        getSubRowsProp={getSubRowsProp}
        onRowClick={onRowClick}
        renderExpandedRow={renderExpandedRow}
        subRowClassName={subRowClassName}
        verticalColumnBorders={verticalColumnBorders}
        sortable
      />
    </SortableContext>
  ) : (
    <DashboardTableBody
      table={table}
      rows={rowModel.rows}
      deletingIds={deletingIds}
      emptyMessage={emptyMessage}
      globalFilter={globalFilter}
      getSubRowsProp={getSubRowsProp}
      onRowClick={onRowClick}
      renderExpandedRow={renderExpandedRow}
      subRowClassName={subRowClassName}
      verticalColumnBorders={verticalColumnBorders}
    />
  );

  const tableElement = (
    <Table
      className={tableClassName}
      containerClassName="overflow-visible"
    >
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup, headerGroupIndex) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => {
              const meta = header.column.columnDef.meta as
                | DashboardColumnMeta
                | undefined;

              return (
                <TableHead
                  key={header.id}
                  colSpan={header.colSpan}
                  style={
                    stickyHeader
                      ? {
                          top: `calc(var(--table-head-height) * ${headerGroupIndex})`,
                        }
                      : undefined
                  }
                  className={cn(
                    meta?.className,
                    stickyHeader && "sticky z-30",
                    verticalColumnBorders && "border-r last:border-r-0"
                  )}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      {tableBody}
    </Table>
  );

  return (
    <>
      <div className="w-full">
        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="Search..."
              aria-label={searchAriaLabel}
              value={globalFilter}
              onChange={(event) => setGlobalFilter(event.target.value)}
              className="w-72 max-w-sm"
            />
            {typeof toolbarContent === "function"
              ? toolbarContent({ table })
              : toolbarContent}
          </div>
          <div className="flex items-center gap-2">
            {hasSelectionMenu && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={
                      selectedCount === 0 ||
                      deleteMutation.isPending ||
                      anySelectionActionPending ||
                      (deleteAction == null && allSelectionActionsDisabled)
                    }
                    className="relative"
                    aria-label={
                      selectedCount > 0
                        ? `Actions (${selectedCount} selected)`
                        : "Actions"
                    }
                  >
                    <HugeiconsIcon
                      icon={MoreVerticalIcon}
                      className="h-4 w-4"
                      aria-hidden
                    />
                    {selectedCount > 0 && (
                      <span
                        aria-hidden
                        className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground"
                      >
                        {selectedCount}
                      </span>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="bg-popover text-popover-foreground"
                >
                  {selectionActions.map((action) => {
                    const disabled =
                      typeof action.disabled === "function"
                        ? action.disabled(selectedRows)
                        : action.disabled === true;

                    return (
                      <DropdownMenuItem
                        key={action.label}
                        variant={
                          action.variant === "destructive" ? "destructive" : undefined
                        }
                        disabled={disabled}
                        onClick={() =>
                          action.onSelect(selectedRows, {
                            clearSelection: () => setRowSelection({}),
                          })
                        }
                      >
                        {action.label}
                      </DropdownMenuItem>
                    );
                  })}
                  {deleteAction ? (
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => {
                        setPendingDeleteIds(selectedRows.map((row) => row.id));
                        setConfirmDeleteOpen(true);
                      }}
                    >
                      Delete
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {addActions && addAriaLabel ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="default" aria-label={addAriaLabel}>
                    {addAriaLabel}
                    <HugeiconsIcon
                      icon={Add01Icon}
                      className="h-4 w-4"
                      data-icon="inline-end"
                      aria-hidden
                    />
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      className="h-3 w-3"
                      data-icon="inline-end"
                      aria-hidden
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="bg-popover text-popover-foreground"
                >
                  {addActions.map((action) => (
                    <DropdownMenuItem key={action.href} asChild>
                      <Link href={action.href} prefetch={false}>{action.label}</Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : addHref && addAriaLabel ? (
              <Button variant="default" aria-label={addAriaLabel} asChild>
                <Link href={addHref} prefetch={false}>
                  {addAriaLabel}
                  <HugeiconsIcon
                    icon={Add01Icon}
                    className="h-4 w-4"
                    data-icon="inline-end"
                    aria-hidden
                  />
                </Link>
              </Button>
            ) : null}
          </div>
        </div>

        {(formError || errorMessage) && (
          <p className="pb-4 text-sm text-destructive">
            {formError ?? errorMessage}
          </p>
        )}

        <div
          className={cn(
            "rounded-md border max-md:overflow-x-auto",
            tableWrapperClassName
          )}
        >
          {reorderEnabled ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              {tableElement}
            </DndContext>
          ) : (
            tableElement
          )}
        </div>

        <div className="flex items-center justify-between py-4">
          <div className="text-sm text-muted-foreground">
            {selectedCount > 0
              ? `${selectedCount} of ${table.getFilteredRowModel().rows.length} row(s) selected.`
              : `Page ${table.getState().pagination.pageIndex + 1} of ${table.getPageCount()}`}
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Rows</span>
              <Select
                value={String(table.getState().pagination.pageSize)}
                onValueChange={(value) => table.setPageSize(Number(value))}
              >
                <SelectTrigger size="sm" className="w-auto" aria-label="Rows per page">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      </div>

      {deleteAction && (
        <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
          <AlertDialogContent className="bg-background text-foreground">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {deleteAction.confirmTitle(pendingDeleteIds.length)}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {deleteAction.confirmDescription(pendingDeleteIds.length)}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(pendingDeleteIds)}
              >
                {deleteMutation.isPending
                  ? (deleteAction.pendingLabel ?? "Deleting...")
                  : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}

type DashboardTableBodyProps<TData extends { id: string }> = {
  table: TanStackTable<TData>;
  rows: Row<TData>[];
  deletingIds: Set<string>;
  emptyMessage: string;
  globalFilter: string;
  getSubRowsProp?: (row: TData) => TData[] | undefined;
  onRowClick?: (row: TData) => void;
  renderExpandedRow?: (row: Row<TData>) => React.ReactNode;
  subRowClassName?: string;
  sortable?: boolean;
  verticalColumnBorders?: boolean;
};

function DashboardTableBody<TData extends { id: string }>({
  table,
  rows,
  deletingIds,
  emptyMessage,
  globalFilter,
  getSubRowsProp,
  onRowClick,
  renderExpandedRow,
  subRowClassName,
  sortable = false,
  verticalColumnBorders = false,
}: DashboardTableBodyProps<TData>) {
  return (
    <TableBody>
      {rows.length ? (
        rows.map((row) => (
          <DashboardTableRow
            key={row.id}
            row={row}
            deletingIds={deletingIds}
            getSubRowsProp={getSubRowsProp}
            onRowClick={onRowClick}
            renderExpandedRow={renderExpandedRow}
            subRowClassName={subRowClassName}
            sortable={sortable}
            verticalColumnBorders={verticalColumnBorders}
          />
        ))
      ) : (
        <TableRow>
          <TableCell
            colSpan={table.getAllLeafColumns().length}
            className="h-24 text-center text-muted-foreground"
          >
            {globalFilter ? `No results for "${globalFilter}"` : emptyMessage}
          </TableCell>
        </TableRow>
      )}
    </TableBody>
  );
}

type DashboardTableRowProps<TData extends { id: string }> = {
  row: Row<TData>;
  deletingIds: Set<string>;
  getSubRowsProp?: (row: TData) => TData[] | undefined;
  onRowClick?: (row: TData) => void;
  renderExpandedRow?: (row: Row<TData>) => React.ReactNode;
  subRowClassName?: string;
  sortable: boolean;
  verticalColumnBorders: boolean;
};

function DashboardTableRow<TData extends { id: string }>({
  row,
  deletingIds,
  getSubRowsProp,
  onRowClick,
  renderExpandedRow,
  subRowClassName,
  sortable,
  verticalColumnBorders,
}: DashboardTableRowProps<TData>) {
  if (sortable) {
    return (
      <SortableDashboardTableRow
        row={row}
        deletingIds={deletingIds}
        getSubRowsProp={getSubRowsProp}
        onRowClick={onRowClick}
        renderExpandedRow={renderExpandedRow}
        subRowClassName={subRowClassName}
        verticalColumnBorders={verticalColumnBorders}
      />
    );
  }

  return (
    <PlainDashboardTableRow
      row={row}
      deletingIds={deletingIds}
      getSubRowsProp={getSubRowsProp}
      onRowClick={onRowClick}
      renderExpandedRow={renderExpandedRow}
      subRowClassName={subRowClassName}
      verticalColumnBorders={verticalColumnBorders}
    />
  );
}

function SortableDashboardTableRow<TData extends { id: string }>({
  row,
  deletingIds,
  getSubRowsProp,
  onRowClick,
  renderExpandedRow,
  subRowClassName,
  verticalColumnBorders,
}: Omit<DashboardTableRowProps<TData>, "sortable">) {
  const sortableItem = useSortable({ id: row.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(sortableItem.transform),
    transition: sortableItem.transition,
    zIndex: sortableItem.isDragging ? 1 : undefined,
    position: sortableItem.isDragging ? "relative" : undefined,
  };

  return (
    <RowReorderHandleContext.Provider
      value={{
        attributes: sortableItem.attributes,
        listeners: sortableItem.listeners,
        disabled: false,
      }}
    >
      <DashboardTableRowContent
        row={row}
        deletingIds={deletingIds}
        getSubRowsProp={getSubRowsProp}
        onRowClick={onRowClick}
        renderExpandedRow={renderExpandedRow}
        subRowClassName={subRowClassName}
        verticalColumnBorders={verticalColumnBorders}
        sortableRef={sortableItem.setNodeRef}
        style={style}
        isDragging={sortableItem.isDragging}
      />
    </RowReorderHandleContext.Provider>
  );
}

function PlainDashboardTableRow<TData extends { id: string }>(
  props: Omit<DashboardTableRowProps<TData>, "sortable">
) {
  return (
    <DashboardTableRowContent
      {...props}
      sortableRef={undefined}
      style={undefined}
      isDragging={false}
    />
  );
}

function DashboardTableRowContent<TData extends { id: string }>({
  row,
  deletingIds,
  getSubRowsProp,
  onRowClick,
  renderExpandedRow,
  subRowClassName,
  verticalColumnBorders,
  sortableRef,
  style,
  isDragging,
}: Omit<DashboardTableRowProps<TData>, "sortable"> & {
  sortableRef: ((node: HTMLElement | null) => void) | undefined;
  style: CSSProperties | undefined;
  isDragging: boolean;
}) {
  return (
    <Fragment>
      <TableRow
        ref={sortableRef}
        style={style}
        data-state={row.getIsSelected() && "selected"}
        tabIndex={onRowClick ? 0 : undefined}
        onClick={(event) => {
          if (!onRowClick || isInteractiveRowTarget(event.target)) return;
          onRowClick(row.original);
        }}
        onKeyDown={(event) => {
          if (
            !onRowClick ||
            isInteractiveRowTarget(event.target) ||
            (event.key !== "Enter" && event.key !== " ")
          ) {
            return;
          }

          event.preventDefault();
          onRowClick(row.original);
        }}
        className={cn(
          deletingIds.has(row.original.id) && "opacity-50",
          row.depth > 0 && subRowClassName,
          onRowClick && "cursor-pointer",
          isDragging && "bg-background shadow-md"
        )}
      >
        {row.getVisibleCells().map((cell) => {
          const meta = cell.column.columnDef.meta as DashboardColumnMeta | undefined;

          return (
            <TableCell
              key={cell.id}
              className={cn(
                meta?.className,
                "align-middle",
                verticalColumnBorders && "border-r last:border-r-0"
              )}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </TableCell>
          );
        })}
      </TableRow>
      {renderExpandedRow && row.getIsExpanded() && !getSubRowsProp && (
        <TableRow key={`${row.id}-expanded`} className="hover:bg-transparent">
          <TableCell colSpan={row.getVisibleCells().length} className="p-0">
            {renderExpandedRow(row)}
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}

export function DashboardDataTableDragHandle({
  label = "Reorder row",
}: {
  label?: string;
}) {
  const context = useContext(RowReorderHandleContext);

  if (!context) {
    return null;
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      className="cursor-grab text-muted-foreground active:cursor-grabbing"
      disabled={context.disabled}
      data-row-click-ignore="true"
      {...context.attributes}
      {...context.listeners}
    >
      <HugeiconsIcon icon={DragDropVerticalIcon} strokeWidth={2} />
    </Button>
  );
}

function getColumnFiltersFromSearchParams<TData>(
  searchParams: Pick<URLSearchParams, "get" | "has">,
  columns: ColumnDef<TData>[],
  initialColumnFilters: ColumnFiltersState | undefined
): ColumnFiltersState {
  const filters = new Map<string, unknown>(
    (initialColumnFilters ?? []).map((filter) => [filter.id, filter.value])
  );

  for (const column of columns) {
    const columnId = getColumnId(column);

    if (!columnId || !searchParams.has(columnId)) {
      continue;
    }

    const value = searchParams.get(columnId)?.trim();

    if (!value || value === "all") {
      filters.delete(columnId);
      continue;
    }

    const values = value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    if (values.length > 0) {
      filters.set(columnId, values);
    }
  }

  return Array.from(filters.entries()).map(([id, value]) => ({ id, value }));
}

function getColumnId<TData>(column: ColumnDef<TData>) {
  if ("id" in column && typeof column.id === "string") {
    return column.id;
  }

  if ("accessorKey" in column && typeof column.accessorKey === "string") {
    return column.accessorKey;
  }

  return null;
}
