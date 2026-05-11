"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiJson, getApiErrorMessage } from "@/lib/client/api";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { DashboardDataTable } from "@/components/dashboard-data-table";
import { DataTableStatusFilter } from "@/components/data-table-status-filter";
import { multiValueFilter } from "@/components/filterable-header";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  DraftAllocationTakeoverWarningPayload,
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
  draftAllocationTakeover?: DraftAllocationTakeoverWarningPayload;
};

type ConfirmMutationInput = {
  ids: string[];
  confirmOversell: boolean;
  confirmDraftAllocationTakeover?: boolean;
  idempotencyKey: string;
};

const SALES_STATUS_FILTER_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "confirmed", label: "Confirmed" },
  { value: "shipped", label: "Shipped" },
  { value: "cancelled", label: "Cancelled" },
] as const;

function NotesCell({ notes }: { notes: string | null }) {
  const trimmedNotes = notes?.trim();

  if (!trimmedNotes) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="block max-w-48 truncate text-left text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
        >
          {trimmedNotes}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-80 whitespace-pre-wrap">
        {trimmedNotes}
      </TooltipContent>
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
    accessorKey: "notes",
    header: ({ column }) => <SortableHeader column={column} label="Notes" />,
    cell: ({ row }) => <NotesCell notes={row.original.notes} />,
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
      <SortableHeader
        column={column}
        label="Status"
        tooltip={SALES_ORDER_STATUS_COLUMN_TOOLTIP}
      />
    ),
    filterFn: multiValueFilter,
    cell: ({ row }) => <SalesOrderStatusBadge status={row.original.status} />,
  },
  {
    id: "fulfillment",
    header: ({ column }) => <SortableHeader column={column} label="Fulfillment" />,
    sortingFn: (a, b) =>
      parseFloat(a.original.fulfillmentSummary.shortQty) -
      parseFloat(b.original.fulfillmentSummary.shortQty),
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.fulfillmentSummary.label}
      </span>
    ),
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
  const [draftTakeoverWarning, setDraftTakeoverWarning] =
    useState<DraftAllocationTakeoverWarningPayload | null>(null);
  const clearSelectionRef = useRef<(() => void) | null>(null);
  const pendingConfirmIdempotencyKeyRef = useRef<string | null>(null);

  const confirmMutation = useMutation({
    mutationFn: async ({
      ids,
      confirmOversell,
      confirmDraftAllocationTakeover,
      idempotencyKey,
    }: ConfirmMutationInput) => {
      await apiJson<void>("/api/sales-orders/bulk-confirm", {
        method: "POST",
        idempotencyKey,
        body: { ids, confirmOversell, confirmDraftAllocationTakeover },
        fallbackError: "Failed to confirm orders.",
        mapError: (status, body) => {
          const payload = body as
            | {
                error?: unknown;
                oversell?: BulkOversellWarningPayload;
                draftAllocationTakeover?: DraftAllocationTakeoverWarningPayload;
              }
            | null;
          const message = getApiErrorMessage(payload, "Failed to confirm orders.");
          return Object.assign(new Error(message), {
            status,
            error: message,
            oversell: payload?.oversell,
            draftAllocationTakeover: payload?.draftAllocationTakeover,
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
      setDraftTakeoverWarning(null);
      clearSelectionRef.current?.();
      clearSelectionRef.current = null;
    },
    onError: (error: ConfirmError) => {
      if (error.status === 409 && error.oversell) {
        setBulkOversellWarning(error.oversell);
        return;
      }
      if (error.status === 409 && error.draftAllocationTakeover) {
        setDraftTakeoverWarning(error.draftAllocationTakeover);
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
        toolbarContent={({ table }) => (
          <DataTableStatusFilter
            table={table}
            options={SALES_STATUS_FILTER_OPTIONS}
            ariaLabel="Filter sales orders by status"
            showAll={false}
          />
        )}
        errorMessage={formError}
        initialSorting={[{ id: "shipDate", desc: false }]}
        initialColumnFilters={[{ id: "status", value: ["draft"] }]}
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
      <AlertDialog
        open={draftTakeoverWarning != null}
        onOpenChange={(open) => {
          if (!open) {
            setDraftTakeoverWarning(null);
            setPendingConfirmIds([]);
            pendingConfirmIdempotencyKeyRef.current = null;
          }
        }}
      >
        <AlertDialogContent size="2xl" className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Take Draft Allocations?</AlertDialogTitle>
            <AlertDialogDescription>
              Confirming these orders will reduce stock allocated to draft orders.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 overflow-y-auto pr-1 text-sm">
            {draftTakeoverWarning?.allocations.map((allocation) => (
              <div
                key={`${allocation.salesOrderLineId}-${allocation.itemId}`}
                className="flex justify-between gap-4 rounded-md border p-2"
              >
                <span>
                  {allocation.orderNumber} · {allocation.customerName} ·{" "}
                  {allocation.itemName}
                </span>
                <span className="font-medium">
                  {allocation.quantity} {allocation.unitName}
                </span>
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
                  confirmOversell: false,
                  confirmDraftAllocationTakeover: true,
                  idempotencyKey,
                });
              }}
            >
              {confirmMutation.isPending ? "Confirming..." : "Take and Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
