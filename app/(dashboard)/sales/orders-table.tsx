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
import { Button, buttonVariants } from "@/components/ui/button";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { OVERSELL_TOOLTIP_COPY } from "@/lib/tooltip-copy";
import { formatDate, formatPrice } from "@/lib/format";
import { SalesOrderStatusBadge } from "./status-badge";
import type {
  BulkOversellWarningPayload,
  SalesOrderListRow,
} from "./types";

type ConfirmError = {
  status?: number;
  error?: string;
  oversell?: BulkOversellWarningPayload;
};

function TooltipHeader({
  label,
  tooltip,
}: {
  label: string;
  tooltip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex w-fit cursor-help underline decoration-dotted decoration-muted-foreground/60 underline-offset-4">
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function DisabledRowAction({
  label,
  tooltip,
}: {
  label: string;
  tooltip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="button"
          aria-disabled="true"
          tabIndex={0}
          className={buttonVariants({
            variant: "ghost",
            size: "sm",
            className: "cursor-not-allowed opacity-50",
          })}
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

const columns: ColumnDef<SalesOrderListRow>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all orders"
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
      <Link href={`/sales/orders/${row.original.id}`} className="hover:underline">
        {row.original.orderNumber}
      </Link>
    ),
  },
  {
    accessorKey: "customerName",
    header: ({ column }) => <SortableHeader column={column} label="Customer" />,
  },
  {
    accessorKey: "itemSummary",
    header: "Items",
  },
  {
    accessorKey: "totalAmount",
    header: ({ column }) => <SortableHeader column={column} label="Total" />,
    sortingFn: (a, b) =>
      parseFloat(a.original.totalAmount) - parseFloat(b.original.totalAmount),
    cell: ({ row }) => formatPrice(row.original.totalAmount) ?? "\u2014",
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <SalesOrderStatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "requestedDate",
    header: ({ column }) => <SortableHeader column={column} label="Requested" />,
    cell: ({ row }) => formatDate(row.original.requestedDate),
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => {
      if (row.original.status !== "confirmed") {
        return null;
      }

      if (!row.original.hasManufacturableLines) {
        return (
          <div className="flex justify-end">
            <DisabledRowAction
              label="Create MOs"
              tooltip={
                row.original.manufacturableDisabledReason ??
                "No manufacturable lines remain on this order."
              }
            />
          </div>
        );
      }

      return (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/manufacturing/orders/new?salesOrderId=${row.original.id}`}>
              Create MOs
            </Link>
          </Button>
        </div>
      );
    },
    enableSorting: false,
  },
];

export function OrdersTable({ initialData }: { initialData: SalesOrderListRow[] }) {
  const queryClient = useQueryClient();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [globalFilter, setGlobalFilter] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [pendingConfirmIds, setPendingConfirmIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [bulkOversellWarning, setBulkOversellWarning] =
    useState<BulkOversellWarningPayload | null>(null);

  const { data = initialData } = useQuery<SalesOrderListRow[]>({
    queryKey: ["sales-orders"],
    queryFn: async () => {
      const response = await fetch("/api/sales-orders");
      if (!response.ok) {
        throw new Error("Failed to fetch orders");
      }
      return response.json();
    },
    initialData,
    initialDataUpdatedAt: 0,
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const response = await fetch("/api/sales-orders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to delete orders.");
      }
    },
    onMutate: () => {
      setFormError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
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

  const confirmMutation = useMutation({
    mutationFn: async ({
      ids,
      confirmOversell,
    }: {
      ids: string[];
      confirmOversell: boolean;
    }) => {
      const response = await fetch("/api/sales-orders/bulk-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, confirmOversell }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw {
          status: response.status,
          error: body?.error ?? "Failed to confirm orders.",
          oversell: body?.oversell,
        } satisfies ConfirmError;
      }
    },
    onMutate: () => {
      setFormError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      setPendingConfirmIds([]);
      setBulkOversellWarning(null);
      setRowSelection({});
    },
    onError: (error: ConfirmError) => {
      if (error.status === 409 && error.oversell) {
        setBulkOversellWarning(error.oversell);
        return;
      }

      setFormError(error.error ?? "Failed to confirm orders.");
    },
  });

  // TanStack Table returns instance methods that React Compiler treats as incompatible.
  // This table still needs custom bulk-confirm and row actions that do not fit the shared shell.
  // eslint-disable-next-line react-hooks/incompatible-library
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

  const selectedRows = table.getFilteredSelectedRowModel().rows;
  const selectedOrderIds = Object.entries(rowSelection)
    .filter(([, isSelected]) => isSelected)
    .map(([rowId]) => {
      try {
        return table.getRow(rowId).original.id;
      } catch {
        return null;
      }
    })
    .filter((id): id is string => id != null);
  const selectedOrders = data.filter((order) => selectedOrderIds.includes(order.id));
  const selectedCount = selectedRows.length;
  const canBulkConfirm =
    selectedOrders.length > 0 &&
    selectedOrders.every((order) => order.status === "draft");

  return (
    <>
      <div className="w-full">
        <div className="flex items-center justify-between py-4">
          <Input
            placeholder="Search..."
            aria-label="Search orders"
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
                  disabled={
                    selectedCount === 0 ||
                    deleteMutation.isPending ||
                    confirmMutation.isPending
                  }
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
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={!canBulkConfirm}
                  onClick={() => {
                    const ids = selectedRows.map((row) => row.original.id);
                    setPendingConfirmIds(ids);
                    confirmMutation.mutate({ ids, confirmOversell: false });
                  }}
                >
                  Confirm Selected
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => {
                    setPendingDeleteIds(selectedRows.map((row) => row.original.id));
                    setConfirmDeleteOpen(true);
                  }}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="default" size="icon" aria-label="Add order" asChild>
              <Link href="/sales/orders/new">
                <HugeiconsIcon icon={Add01Icon} className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </div>

        {formError && <p className="pb-4 text-sm text-destructive">{formError}</p>}

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
                      : "No sales orders yet."}
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
            <AlertDialogTitle>
              Delete {pendingDeleteIds.length} order{pendingDeleteIds.length !== 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The selected order{pendingDeleteIds.length !== 1 ? "s" : ""} will be soft-deleted.
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

      <AlertDialog
        open={bulkOversellWarning != null}
        onOpenChange={(open) => {
          if (!open) {
            setBulkOversellWarning(null);
          }
        }}
      >
        <AlertDialogContent className="max-w-5xl bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Oversell?</AlertDialogTitle>
            <AlertDialogDescription>
              Confirming the selected orders would oversell one or more products.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4 overflow-y-auto pr-1">
            {bulkOversellWarning?.orders.map((warningOrder) => (
              <div key={warningOrder.salesOrderId} className="space-y-2">
                <div>
                  <h3 className="text-sm font-semibold">{warningOrder.salesOrderNumber}</h3>
                </div>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Current Stock</TableHead>
                        <TableHead>
                          <TooltipHeader
                            label="Current Committed"
                            tooltip={OVERSELL_TOOLTIP_COPY.currentCommitted}
                          />
                        </TableHead>
                        <TableHead>
                          <TooltipHeader
                            label="Expected"
                            tooltip={OVERSELL_TOOLTIP_COPY.expected}
                          />
                        </TableHead>
                        <TableHead>
                          <TooltipHeader
                            label="Safety"
                            tooltip={OVERSELL_TOOLTIP_COPY.safety}
                          />
                        </TableHead>
                        <TableHead>
                          <TooltipHeader
                            label="Current Calculated"
                            tooltip={OVERSELL_TOOLTIP_COPY.currentCalculated}
                          />
                        </TableHead>
                        <TableHead>Added Qty</TableHead>
                        <TableHead>
                          <TooltipHeader
                            label="Projected Committed"
                            tooltip={OVERSELL_TOOLTIP_COPY.projectedCommitted}
                          />
                        </TableHead>
                        <TableHead>
                          <TooltipHeader
                            label="Projected Calculated"
                            tooltip={OVERSELL_TOOLTIP_COPY.projectedCalculated}
                          />
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {warningOrder.products.map((product) => (
                        <TableRow key={`${warningOrder.salesOrderId}-${product.itemId}`}>
                          <TableCell>
                            <div className="font-medium">{product.itemName}</div>
                            {product.itemSku && (
                              <div className="text-xs text-muted-foreground">
                                {product.itemSku}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            {product.inStock} {product.unitName}
                          </TableCell>
                          <TableCell>
                            {product.committedQty} {product.unitName}
                          </TableCell>
                          <TableCell>
                            {product.expectedQty} {product.unitName}
                          </TableCell>
                          <TableCell>
                            {product.safetyStock} {product.unitName}
                          </TableCell>
                          <TableCell>
                            {product.calculatedStock} {product.unitName}
                          </TableCell>
                          <TableCell>
                            {product.addedQty} {product.unitName}
                          </TableCell>
                          <TableCell>
                            {product.projectedCommittedQty} {product.unitName}
                          </TableCell>
                          <TableCell className="text-destructive">
                            {product.projectedCalculatedStock} {product.unitName}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmMutation.isPending}
              onClick={() => {
                if (pendingConfirmIds.length === 0) return;
                confirmMutation.mutate({
                  ids: pendingConfirmIds,
                  confirmOversell: true,
                });
              }}
            >
              {confirmMutation.isPending ? "Confirming..." : "Confirm Anyway"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
