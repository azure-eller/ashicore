"use client";

import Link from "next/link";
import { Fragment, useRef, useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@/lib/client/api";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { DashboardDataTable } from "@/components/dashboard-data-table";
import { FilterableHeader, multiValueFilter } from "@/components/filterable-header";
import { QuantityWithUnit } from "@/components/quantity-with-unit";
import { SortableHeader } from "@/components/sortable-header";
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

type ConfirmError = Error & {
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
  const [pendingConfirmIds, setPendingConfirmIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [bulkOversellWarning, setBulkOversellWarning] =
    useState<BulkOversellWarningPayload | null>(null);
  const clearSelectionRef = useRef<(() => void) | null>(null);

  const confirmMutation = useMutation({
    mutationFn: async ({
      ids,
      confirmOversell,
    }: {
      ids: string[];
      confirmOversell: boolean;
    }) => {
      await apiJson<void>("/api/sales-orders/bulk-confirm", {
        method: "POST",
        idempotencyKey: "sales-orders-bulk-confirm",
        body: { ids, confirmOversell },
        fallbackError: "Failed to confirm orders.",
        mapError: (status, body) => {
          const payload = body as
            | { error?: unknown; oversell?: BulkOversellWarningPayload }
            | null;
          const message =
            typeof payload?.error === "string"
              ? payload.error
              : "Failed to confirm orders.";
          return Object.assign(new Error(message), {
            status,
            error: message,
            oversell: payload?.oversell,
          } satisfies Omit<ConfirmError, keyof Error>);
        },
      });
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
      clearSelectionRef.current?.();
      clearSelectionRef.current = null;
    },
    onError: (error: ConfirmError) => {
      if (error.status === 409 && error.oversell) {
        setBulkOversellWarning(error.oversell);
        return;
      }

      setFormError(error.error ?? "Failed to confirm orders.");
    },
  });

  return (
    <>
      <DashboardDataTable
        columns={columns}
        initialData={initialData}
        queryKey={["sales-orders"]}
        queryFn={() =>
          apiJson<SalesOrderListRow[]>("/api/sales-orders", {
            fallbackError: "Failed to fetch orders.",
          })
        }
        searchAriaLabel="Search orders"
        addHref="/sales/orders/new"
        addAriaLabel="New Order"
        emptyMessage="No sales orders yet."
        errorMessage={formError}
        initialSorting={[{ id: "requestedDate", desc: false }]}
        getRowCanExpand={() => true}
        renderExpandedRow={(row) => <OrderExpandedDetail orderId={row.original.id} />}
        selectedActions={[
          {
            label: "Confirm Selected",
            disabled: (orders) =>
              orders.length === 0 ||
              confirmMutation.isPending ||
              !orders.every((order) => order.status === "draft"),
            isPending: confirmMutation.isPending,
            onSelect: (orders, { clearSelection }) => {
              const ids = orders.map((order) => order.id);
              clearSelectionRef.current = clearSelection;
              setPendingConfirmIds(ids);
              confirmMutation.mutate({ ids, confirmOversell: false });
            },
          },
        ]}
        deleteAction={{
          endpoint: "/api/sales-orders",
          invalidateQueryKeys: [["sales-orders"], ["items"]],
          defaultErrorMessage: "Failed to delete orders.",
          idempotencyKey: "sales-orders-delete",
          confirmTitle: (count) =>
            `Delete ${count} order${count !== 1 ? "s" : ""}?`,
          confirmDescription: (count) =>
            `The selected order${count !== 1 ? "s" : ""} will be soft-deleted.`,
        }}
      />

      <AlertDialog
        open={bulkOversellWarning != null}
        onOpenChange={(open) => {
          if (!open) {
            setBulkOversellWarning(null);
          }
        }}
      >
        <AlertDialogContent size="content" className="bg-background text-foreground">
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
                            <QuantityWithUnit value={product.inStock} unitName={product.unitName} />
                          </TableCell>
                          <TableCell>
                            <QuantityWithUnit value={product.availableQty} unitName={product.unitName} />
                          </TableCell>
                          <TableCell>
                            <QuantityWithUnit value={product.committedQty} unitName={product.unitName} />
                          </TableCell>
                          <TableCell>
                            <QuantityWithUnit value={product.demandQty} unitName={product.unitName} />
                          </TableCell>
                          <TableCell>
                            <QuantityWithUnit value={product.shortageQty} unitName={product.unitName} />
                          </TableCell>
                          <TableCell>
                            <QuantityWithUnit value={product.expectedQty} unitName={product.unitName} />
                          </TableCell>
                          <TableCell>
                            <QuantityWithUnit value={product.safetyStock} unitName={product.unitName} />
                          </TableCell>
                          <TableCell>
                            <QuantityWithUnit value={product.calculatedStock} unitName={product.unitName} />
                          </TableCell>
                          <TableCell>
                            <QuantityWithUnit value={product.addedQty} unitName={product.unitName} />
                          </TableCell>
                          <TableCell>
                            <QuantityWithUnit value={product.projectedDemandQty} unitName={product.unitName} />
                          </TableCell>
                          <TableCell className={product.projectedShortageQty > 0 ? "text-destructive" : undefined}>
                            <QuantityWithUnit
                              value={product.projectedShortageQty}
                              unitName={product.unitName}
                              tone={product.projectedShortageQty > 0 ? "destructive" : "default"}
                            />
                          </TableCell>
                          <TableCell className="text-destructive">
                            <QuantityWithUnit
                              value={product.projectedCalculatedStock}
                              unitName={product.unitName}
                              tone="destructive"
                            />
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
