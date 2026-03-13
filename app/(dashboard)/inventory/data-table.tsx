"use client";

import {
  RowSelectionState,
  SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, MoreVerticalIcon } from "@hugeicons/core-free-icons";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { columns } from "./columns";
import type { ItemRow, ItemType } from "./types";
import { ITEM_TYPE_SEGMENTS } from "./types";

interface DataTableProps {
  initialData: ItemRow[];
  itemType: ItemType;
}

export function DataTable({ initialData, itemType }: DataTableProps) {
  const queryClient = useQueryClient();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [globalFilter, setGlobalFilter] = useState<string>("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);

  const { data = initialData } = useQuery<ItemRow[]>({
    queryKey: ["items", itemType],
    queryFn: async () => {
      const res = await fetch(`/api/items?itemType=${itemType}`);
      if (!res.ok) throw new Error("Failed to fetch items");
      return res.json();
    },
    initialData,
    initialDataUpdatedAt: 0,
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.all(
        ids.map((id) => fetch(`/api/items/${id}`, { method: "DELETE" }))
      );
      const failed = results.filter((r) => !r.ok);
      if (failed.length) throw new Error(`Failed to delete ${failed.length} item(s)`);
    },
    onMutate: (ids) => setDeletingIds(new Set(ids)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["items", itemType] });
      setRowSelection({});
    },
    onSettled: () => {
      setDeletingIds(new Set());
    },
  });

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      sorting,
      rowSelection,
      globalFilter,
    },
  });

  const selectedCount = table.getFilteredSelectedRowModel().rows.length;

  return (
    <>
      <div className="w-full">
        <div className="flex items-center justify-between py-4">
          <Input
            placeholder="Search..."
            aria-label="Search items"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="max-w-sm"
          />
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={selectedCount === 0}
                  className="relative"
                  aria-label={selectedCount > 0 ? `Actions (${selectedCount} selected)` : "Actions"}
                >
                  <HugeiconsIcon icon={MoreVerticalIcon} className="h-4 w-4" aria-hidden />
                  {selectedCount > 0 && (
                    <span aria-hidden className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                      {selectedCount}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  disabled={bulkDeleteMutation.isPending}
                  onClick={() => {
                    setPendingDeleteIds(
                      table.getFilteredSelectedRowModel().rows.map((r) => r.original.id)
                    );
                    setConfirmDeleteOpen(true);
                  }}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="default" size="icon" aria-label="Add item" asChild>
              <Link href={`/inventory/${ITEM_TYPE_SEGMENTS[itemType]}/new`}>
                <HugeiconsIcon icon={Add01Icon} className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
        <div className="rounded-md border">
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
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                    className={deletingIds.has(row.original.id) ? "opacity-50" : undefined}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center text-muted-foreground"
                  >
                    {globalFilter
                      ? `No results for "${globalFilter}"`
                      : "No items yet."}
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

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDeleteIds.length} item{pendingDeleteIds.length !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              The selected item{pendingDeleteIds.length !== 1 ? "s" : ""} will be removed from your inventory.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                bulkDeleteMutation.mutate(pendingDeleteIds);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
