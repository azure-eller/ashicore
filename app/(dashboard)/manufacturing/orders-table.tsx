"use client";

import Link from "next/link";
import { useState } from "react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type RowSelectionState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  MoreVerticalIcon,
} from "@hugeicons/core-free-icons";
import { SortableHeader } from "@/components/sortable-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { formatDate } from "@/lib/format";
import { ManufacturingOrderStatusBadge } from "./status-badge";
import type { ManufacturingOrderListRow } from "./types";

const columns: ColumnDef<ManufacturingOrderListRow>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all manufacturing orders"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label={`Select ${row.original.orderNumber}`}
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "orderNumber",
    header: ({ column }) => <SortableHeader column={column} label="Order" />,
    cell: ({ row }) => (
      <Link
        href={`/manufacturing/orders/${row.original.id}`}
        className="hover:underline"
      >
        {row.original.orderNumber}
      </Link>
    ),
  },
  {
    accessorKey: "productName",
    header: ({ column }) => <SortableHeader column={column} label="Product" />,
    cell: ({ row }) =>
      row.original.productSku
        ? `${row.original.productName} (${row.original.productSku})`
        : row.original.productName,
  },
  {
    accessorKey: "salesOrderNumber",
    header: "Sales Order",
    cell: ({ row }) => row.original.salesOrderNumber ?? "\u2014",
  },
  {
    accessorKey: "plannedQuantity",
    header: ({ column }) => <SortableHeader column={column} label="Planned" />,
    sortingFn: (a, b) =>
      parseFloat(a.original.plannedQuantity) - parseFloat(b.original.plannedQuantity),
    cell: ({ row }) =>
      `${parseFloat(row.original.plannedQuantity)} ${row.original.unitName}`,
  },
  {
    accessorKey: "actualQuantity",
    header: "Actual",
    cell: ({ row }) =>
      row.original.actualQuantity != null
        ? `${parseFloat(row.original.actualQuantity)} ${row.original.unitName}`
        : "\u2014",
  },
  {
    accessorKey: "plannedDate",
    header: ({ column }) => <SortableHeader column={column} label="Planned Date" />,
    cell: ({ row }) => formatDate(row.original.plannedDate),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <ManufacturingOrderStatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "completedAt",
    header: ({ column }) => <SortableHeader column={column} label="Completed" />,
    cell: ({ row }) => formatDate(row.original.completedAt),
  },
];

export function OrdersTable({
  initialData,
}: {
  initialData: ManufacturingOrderListRow[];
}) {
  const queryClient = useQueryClient();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [globalFilter, setGlobalFilter] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const { data = initialData } = useQuery<ManufacturingOrderListRow[]>({
    queryKey: ["manufacturing-orders"],
    queryFn: async () => {
      const response = await fetch("/api/manufacturing-orders");
      if (!response.ok) {
        throw new Error("Failed to fetch manufacturing orders");
      }
      return response.json();
    },
    initialData,
    initialDataUpdatedAt: 0,
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const response = await fetch("/api/manufacturing-orders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to delete manufacturing orders.");
      }
    },
    onMutate: () => {
      setFormError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      setConfirmDeleteOpen(false);
      setPendingDeleteIds([]);
      setRowSelection({});
    },
    onError: (error) => {
      setFormError(error.message);
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
            aria-label="Search manufacturing orders"
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            className="max-w-sm"
          />
          <div className="flex items-center gap-2">
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
                  <HugeiconsIcon icon={MoreVerticalIcon} className="h-4 w-4" aria-hidden />
                  {selectedCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
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
            <Button variant="default" size="icon" aria-label="Add order" asChild>
              <Link href="/manufacturing/orders/new">
                <HugeiconsIcon icon={Add01Icon} className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </div>

        {formError && (
          <p className="pb-4 text-sm text-destructive">{formError}</p>
        )}

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
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
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
                      : "No manufacturing orders yet."}
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
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {pendingDeleteIds.length} manufacturing order
              {pendingDeleteIds.length !== 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Draft, completed, or cancelled orders will be soft-deleted and removed
              from normal views. Released orders must be cancelled first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(pendingDeleteIds)}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
