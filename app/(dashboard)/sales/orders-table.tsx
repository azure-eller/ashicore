"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type ExpandedState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type RowSelectionState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  MoreVerticalIcon,
} from "@hugeicons/core-free-icons";
import { FilterableHeader, multiValueFilter } from "@/components/filterable-header";
import { SortableHeader } from "@/components/sortable-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TooltipHeader } from "@/components/tooltip-header";
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
import {
  ON_HAND_STOCK_TOOLTIP,
  OVERSELL_TOOLTIP_COPY,
  REQUESTED_DATE_TOOLTIP,
  SALES_ADDED_QTY_TOOLTIP,
  SALES_ORDER_STATUS_COLUMN_TOOLTIP,
} from "@/lib/tooltip-copy";
import { formatDate, formatPrice, formatQuantity } from "@/lib/format";
import { SalesOrderStatusBadge } from "./status-badge";
import { SoStageAction } from "./so-stage-action";
import { OrderExpandedDetail } from "./order-expanded-detail";
import { OrderLineAttributeBadges } from "./order-line-attribute-badges";
import type {
  BulkOversellWarningPayload,
  SalesOrderListLine,
  SalesOrderListRow,
} from "./types";

type ConfirmError = {
  status?: number;
  error?: string;
  oversell?: BulkOversellWarningPayload;
};

function SalesOrderItemsCell({
  lines,
  fallback,
}: {
  lines: SalesOrderListLine[];
  fallback: string;
}) {
  if (lines.length === 0) {
    return <span className="text-muted-foreground">{fallback}</span>;
  }

  const visibleLines = lines.slice(0, 2);
  const hiddenCount = lines.length - visibleLines.length;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {visibleLines.map((line, index) => (
        <Fragment key={`${line.masterName}-${line.quantity}-${index}`}>
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span className="shrink-0">{formatQuantity(line.quantity)}</span>
            <span className="truncate">{line.masterName}</span>
            <OrderLineAttributeBadges attrs={line.attrs} />
          </span>
          {index < visibleLines.length - 1 && (
            <span className="text-muted-foreground">,</span>
          )}
        </Fragment>
      ))}
      {hiddenCount > 0 && (
        <span className="shrink-0 text-muted-foreground">+ {hiddenCount} more</span>
      )}
    </div>
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
      <div className="flex items-center gap-1.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            row.toggleExpanded();
          }}
          aria-label={row.getIsExpanded() ? "Collapse order" : "Expand order"}
          className="p-0.5 text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon
            icon={row.getIsExpanded() ? ArrowDown01Icon : ArrowRight01Icon}
            className="h-4 w-4"
          />
        </button>
        <Link href={`/sales/orders/${row.original.id}`} className="hover:underline">
          {row.original.orderNumber}
        </Link>
      </div>
    ),
  },
  {
    accessorKey: "customerName",
    header: ({ column }) => <SortableHeader column={column} label="Customer" />,
  },
  {
    accessorKey: "itemSummary",
    header: "Items",
    cell: ({ row }) => (
      <SalesOrderItemsCell
        lines={row.original.lines}
        fallback={row.original.itemSummary}
      />
    ),
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
    header: ({ column }) => (
      <FilterableHeader
        column={column}
        label="Status"
        tooltip={SALES_ORDER_STATUS_COLUMN_TOOLTIP}
      />
    ),
    filterFn: multiValueFilter,
    cell: ({ row }) => <SalesOrderStatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "requestedDate",
    header: ({ column }) => (
      <SortableHeader column={column} label="Requested" tooltip={REQUESTED_DATE_TOOLTIP} />
    ),
    cell: ({ row }) => formatDate(row.original.requestedDate),
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => <SoStageAction order={row.original} />,
    enableSorting: false,
  },
];

export function OrdersTable({ initialData }: { initialData: SalesOrderListRow[] }) {
  const queryClient = useQueryClient();
  const [sorting, setSorting] = useState<SortingState>([
    { id: "requestedDate", desc: false },
  ]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [pendingConfirmIds, setPendingConfirmIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<ExpandedState>({});
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
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const response = await fetch("/api/sales-orders", {
        method: "DELETE",
        headers: createIdempotencyHeaders("sales-orders-delete", {
          "Content-Type": "application/json",
        }),
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
        headers: createIdempotencyHeaders("sales-orders-bulk-confirm", {
          "Content-Type": "application/json",
        }),
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
    onColumnFiltersChange: setColumnFilters,
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    onExpandedChange: setExpanded,
    initialState: {
      pagination: { pageSize: 25 },
    },
    state: {
      sorting,
      rowSelection,
      globalFilter,
      columnFilters,
      expanded,
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
              <DropdownMenuContent
                align="end"
                className="bg-popover text-popover-foreground"
              >
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
            <Button variant="default" aria-label="New Order" asChild>
              <Link href="/sales/orders/new">
                New Order
                <HugeiconsIcon
                  icon={Add01Icon}
                  className="h-4 w-4"
                  data-icon="inline-end"
                  aria-hidden
                />
              </Link>
            </Button>
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
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                    {row.getIsExpanded() && (
                      <TableRow key={`${row.id}-expanded`} className="hover:bg-transparent">
                        <TableCell colSpan={columns.length} className="p-0">
                          <OrderExpandedDetail orderId={row.original.id} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
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

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent className="bg-background text-foreground">
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
              Confirming the selected orders would oversell one or more items.
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
                        <TableHead>Item</TableHead>
                        <TableHead>
                          <TooltipHeader label="Current Stock" tooltip={ON_HAND_STOCK_TOOLTIP} />
                        </TableHead>
                        <TableHead>
                          <TooltipHeader
                            label="Available"
                            tooltip={OVERSELL_TOOLTIP_COPY.currentAvailable}
                          />
                        </TableHead>
                        <TableHead>
                          <TooltipHeader
                            label="Reserved"
                            tooltip={OVERSELL_TOOLTIP_COPY.currentReserved}
                          />
                        </TableHead>
                        <TableHead>
                          <TooltipHeader
                            label="Demand"
                            tooltip={OVERSELL_TOOLTIP_COPY.currentDemand}
                          />
                        </TableHead>
                        <TableHead>
                          <TooltipHeader
                            label="Backorder"
                            tooltip={OVERSELL_TOOLTIP_COPY.currentShortage}
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
                        <TableHead>
                          <TooltipHeader label="Added Qty" tooltip={SALES_ADDED_QTY_TOOLTIP} />
                        </TableHead>
                        <TableHead>
                          <TooltipHeader
                            label="Projected Demand"
                            tooltip={OVERSELL_TOOLTIP_COPY.projectedDemand}
                          />
                        </TableHead>
                        <TableHead>
                          <TooltipHeader
                            label="Projected Backorder"
                            tooltip={OVERSELL_TOOLTIP_COPY.projectedShortage}
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
                            {product.availableQty} {product.unitName}
                          </TableCell>
                          <TableCell>
                            {product.committedQty} {product.unitName}
                          </TableCell>
                          <TableCell>
                            {product.demandQty} {product.unitName}
                          </TableCell>
                          <TableCell>
                            {product.shortageQty} {product.unitName}
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
                            {product.projectedDemandQty} {product.unitName}
                          </TableCell>
                          <TableCell className={product.projectedShortageQty > 0 ? "text-destructive" : undefined}>
                            {product.projectedShortageQty} {product.unitName}
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
