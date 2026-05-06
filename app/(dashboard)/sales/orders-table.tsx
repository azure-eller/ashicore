"use client";

import Link from "next/link";
import { useRef, useState } from "react";
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
import { SortableHeader } from "@/components/sortable-header";
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
  REQUESTED_DATE_TOOLTIP,
  SALES_ORDER_SHIP_DATE_TOOLTIP,
  SALES_ORDER_DATE_TOOLTIP,
  SALES_ORDER_STATUS_COLUMN_TOOLTIP,
} from "@/lib/tooltip-copy";
import { formatDate, formatPrice } from "@/lib/format";
import { SalesOrderStatusBadge } from "./status-badge";
import { SoStageAction } from "./so-stage-action";
import { OrderExpandedDetail } from "./order-expanded-detail";
import type {
  BulkOversellWarningPayload,
  SalesOrderListRow,
} from "./types";
import {
  OVERSELL_WARNING_DESCRIPTION,
  OversellWarningTable,
} from "./oversell-warning-table";

type ConfirmError = Error & {
  status?: number;
  error?: string;
  oversell?: BulkOversellWarningPayload;
};

type ConfirmMutationInput = {
  ids: string[];
  confirmOversell: boolean;
  idempotencyKey: string;
};

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
    accessorKey: "orderDate",
    header: ({ column }) => (
      <SortableHeader column={column} label="Order" tooltip={SALES_ORDER_DATE_TOOLTIP} />
    ),
    cell: ({ row }) => formatDate(row.original.orderDate),
  },
  {
    accessorKey: "shipDate",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Ship"
        tooltip={SALES_ORDER_SHIP_DATE_TOOLTIP}
      />
    ),
    sortingFn: (a, b) => {
      const dateCompare = (a.original.shipDate ?? "").localeCompare(
        b.original.shipDate ?? ""
      );

      if (dateCompare !== 0) {
        return dateCompare;
      }

      return a.original.orderNumber.localeCompare(b.original.orderNumber, undefined, {
        numeric: true,
      });
    },
    cell: ({ row }) => formatDate(row.original.shipDate),
  },
  {
    accessorKey: "requestedDate",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Delivery"
        tooltip={REQUESTED_DATE_TOOLTIP}
      />
    ),
    sortingFn: (a, b) => {
      const dateCompare = (a.original.requestedDate ?? "").localeCompare(
        b.original.requestedDate ?? ""
      );

      if (dateCompare !== 0) {
        return dateCompare;
      }

      return a.original.orderNumber.localeCompare(b.original.orderNumber, undefined, {
        numeric: true,
      });
    },
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
  const pendingConfirmIdempotencyKeyRef = useRef<string | null>(null);

  const confirmMutation = useMutation({
    mutationFn: async ({
      ids,
      confirmOversell,
      idempotencyKey,
    }: ConfirmMutationInput) => {
      await apiJson<void>("/api/sales-orders/bulk-confirm", {
        method: "POST",
        idempotencyKey,
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
      pendingConfirmIdempotencyKeyRef.current = null;
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
        initialSorting={[{ id: "shipDate", desc: false }]}
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
              const idempotencyKey = `sales-orders-bulk-confirm:${crypto.randomUUID()}`;
              clearSelectionRef.current = clearSelection;
              pendingConfirmIdempotencyKeyRef.current = idempotencyKey;
              setPendingConfirmIds(ids);
              confirmMutation.mutate({ ids, confirmOversell: false, idempotencyKey });
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
            setPendingConfirmIds([]);
            pendingConfirmIdempotencyKeyRef.current = null;
          }
        }}
      >
        <AlertDialogContent size="2xl" className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Oversell?</AlertDialogTitle>
            <AlertDialogDescription>
              {OVERSELL_WARNING_DESCRIPTION}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4 overflow-y-auto pr-1">
            {bulkOversellWarning?.orders.map((warningOrder) => (
              <div key={warningOrder.salesOrderId} className="space-y-2">
                <div>
                  <h3 className="text-sm font-semibold">{warningOrder.salesOrderNumber}</h3>
                </div>
                <OversellWarningTable
                  products={warningOrder.products}
                  rowKeyPrefix={warningOrder.salesOrderId}
                />
              </div>
            ))}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmMutation.isPending}
              onClick={() => {
                const idempotencyKey = pendingConfirmIdempotencyKeyRef.current;
                if (pendingConfirmIds.length === 0 || !idempotencyKey) return;
                confirmMutation.mutate({
                  ids: pendingConfirmIds,
                  confirmOversell: true,
                  idempotencyKey,
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
