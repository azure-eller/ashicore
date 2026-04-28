"use client";

import { Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { Add01Icon, ArrowDown01Icon, MoreVerticalIcon } from "@hugeicons/core-free-icons";
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

type DeleteActionConfig = {
  endpoint: string;
  invalidateQueryKeys: QueryKey[];
  defaultErrorMessage: string;
  confirmTitle: (count: number) => string;
  confirmDescription: (count: number) => string;
  pendingLabel?: string;
  trackDeletingRows?: boolean;
};

type AddAction = {
  label: string;
  href: string;
};

type DashboardDataTableProps<TData extends { id: string }> = {
  columns: ColumnDef<TData>[];
  initialData: TData[];
  queryKey: QueryKey;
  queryFn: () => Promise<TData[]>;
  enableRowSelection?: boolean | ((row: Row<TData>) => boolean);
  searchAriaLabel: string;
  addHref: string;
  addAriaLabel: string;
  emptyMessage: string;
  deleteAction?: DeleteActionConfig;
  addActions?: AddAction[];
  getRowCanExpand?: (row: Row<TData>) => boolean;
  renderExpandedRow?: (row: Row<TData>) => React.ReactNode;
  getSubRows?: (row: TData) => TData[] | undefined;
  subRowClassName?: string;
  globalFilterFn?: FilterFn<TData> | BuiltInFilterFn;
};

export function DashboardDataTable<TData extends { id: string }>({
  columns,
  initialData,
  queryKey,
  queryFn,
  enableRowSelection,
  searchAriaLabel,
  addHref,
  addAriaLabel,
  emptyMessage,
  deleteAction,
  addActions,
  getRowCanExpand: getRowCanExpandProp,
  renderExpandedRow,
  getSubRows: getSubRowsProp,
  subRowClassName,
  globalFilterFn,
}: DashboardDataTableProps<TData>) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const { data = initialData } = useQuery<TData[]>({
    queryKey,
    queryFn,
    initialData,
  });

  const deleteMutation = useMutation<void, Error, string[]>({
    mutationFn: async (ids) => {
      if (!deleteAction) {
        throw new Error("Delete action is not configured.");
      }

      const response = await fetch(deleteAction.endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? deleteAction.defaultErrorMessage);
      }
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

  const rowSelectionConfig = enableRowSelection ?? (deleteAction != null);
  const enableSelection = rowSelectionConfig !== false;
  const hasExpansion = renderExpandedRow != null || getSubRowsProp != null;
  // TanStack Table returns instance methods that React Compiler treats as incompatible.
  // Centralizing the hook here keeps the warning scoped to the shared table shell.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
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
      ...(hasExpansion ? { expanded } : {}),
    },
  });

  const selectedCount = enableSelection
    ? table.getFilteredSelectedRowModel().rows.length
    : 0;

  return (
    <>
      <div className="w-full">
        <div className="flex items-center justify-between py-4">
          <Input
            placeholder="Search..."
            aria-label={searchAriaLabel}
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            className="max-w-sm"
          />
          <div className="flex items-center gap-2">
            {deleteAction && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={selectedCount === 0 || deleteMutation.isPending}
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
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => {
                      setPendingDeleteIds(
                        table
                          .getFilteredSelectedRowModel()
                          .rows.map((row) => row.original.id)
                      );
                      setConfirmDeleteOpen(true);
                    }}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {addActions ? (
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
            ) : (
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
            )}
          </div>
        </div>

        {formError && <p className="pb-4 text-sm text-destructive">{formError}</p>}

        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow
                      data-state={row.getIsSelected() && "selected"}
                      className={
                        [
                          deletingIds.has(row.original.id) ? "opacity-50" : "",
                          row.depth > 0 && subRowClassName ? subRowClassName : "",
                        ].filter(Boolean).join(" ") || undefined
                      }
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                    {renderExpandedRow && row.getIsExpanded() && !getSubRowsProp && (
                      <TableRow key={`${row.id}-expanded`} className="hover:bg-transparent">
                        <TableCell colSpan={row.getVisibleCells().length} className="p-0">
                          {renderExpandedRow(row)}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
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
          </Table>
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
