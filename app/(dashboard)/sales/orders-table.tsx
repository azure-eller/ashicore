"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { type ColumnDef, type Table as TanStackTable } from "@tanstack/react-table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@/lib/client/api";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import {
  DashboardDataTable,
  DashboardDataTableDragHandle,
} from "@/components/dashboard-data-table";
import { multiValueFilter } from "@/components/filterable-header";
import {
  OperationalStateCell,
  type OperationalState,
} from "@/components/operational-state-cell";
import { SortableHeader } from "@/components/sortable-header";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  REQUESTED_DATE_TOOLTIP,
  SALES_ORDER_SHIP_DATE_TOOLTIP,
  SALES_ORDER_DATE_TOOLTIP,
} from "@/lib/tooltip-copy";
import { formatDate, formatPrice } from "@/lib/format";
import { SoStageAction } from "./so-stage-action";
import { OrderExpandedDetail } from "./order-expanded-detail";
import type { SalesOrderListRow } from "./types";

const OPEN_SALES_STATUSES = ["draft", "confirmed", "partially_shipped"] as const;
const DONE_SALES_STATUSES = ["shipped", "cancelled"] as const;
type SalesWorkflowFilterValue = "open" | "done";

function isOpenSalesOrder(order: SalesOrderListRow) {
  return (OPEN_SALES_STATUSES as readonly string[]).includes(order.status);
}

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

function parseQuantity(value: string | null | undefined) {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function getSalesItemsState(order: SalesOrderListRow): OperationalState {
  if (order.status === "cancelled") {
    return { label: "Cancelled", tone: "destructive" };
  }

  if (order.status === "shipped") {
    return { label: "Complete", tone: "success" };
  }

  const remainingQty = parseQuantity(order.fulfillmentSummary.remainingQty);
  const allocatedQty = parseQuantity(order.fulfillmentSummary.allocatedQty);
  const shortQty = parseQuantity(order.fulfillmentSummary.shortQty);

  if (remainingQty <= 0) {
    return { label: "Complete", tone: "success" };
  }

  if (shortQty <= 0) {
    return { label: "Allocated", tone: "success" };
  }

  if (allocatedQty > 0) {
    return { label: "Partial", tone: "warning" };
  }

  return { label: "Not available", tone: "destructive" };
}

function getProductionState(order: SalesOrderListRow): OperationalState {
  if (order.status === "cancelled") {
    return { label: "Cancelled", tone: "destructive" };
  }

  if (!order.hasManufacturableLines) {
    return { label: "No production", tone: "muted" };
  }

  if (order.openManufacturingOrders.some((mo) => mo.status === "released")) {
    return { label: "Work in progress", tone: "warning" };
  }

  if (order.openManufacturingOrders.some((mo) => mo.status === "draft")) {
    return { label: "Not started", tone: "muted" };
  }

  if (parseQuantity(order.fulfillmentSummary.productionAllocatedQty) > 0) {
    return { label: "Done", tone: "success" };
  }

  if (parseQuantity(order.fulfillmentSummary.shortQty) > 0) {
    return { label: "Make", tone: "secondary" };
  }

  return { label: "No production", tone: "muted" };
}

function getDeliveryState(order: SalesOrderListRow): OperationalState {
  if (order.status === "draft") {
    return { label: "Draft", tone: "muted" };
  }

  if (order.status === "cancelled") {
    return { label: "Cancelled", tone: "destructive" };
  }

  if (order.status === "shipped") {
    return { label: "Shipped", tone: "success" };
  }

  if (order.status === "partially_shipped") {
    return { label: "Partially shipped", tone: "warning" };
  }

  return { label: "Not shipped", tone: "muted" };
}

function doneSalesOrderRank(order: SalesOrderListRow) {
  if (order.status === "cancelled") return 1;
  if (order.status === "shipped") return 0;
  return -1;
}

function RankCell({ rowIndex, order }: { rowIndex: number; order: SalesOrderListRow }) {
  if (!isOpenSalesOrder(order)) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <div className="flex items-center gap-1.5">
      <DashboardDataTableDragHandle label={`Reorder ${order.orderNumber}`} />
      <span className="w-6 text-sm text-muted-foreground tabular-nums">
        {order.priorityRank ?? rowIndex + 1}
      </span>
    </div>
  );
}

const rankColumn: ColumnDef<SalesOrderListRow> = {
  accessorKey: "priorityRank",
  header: "Rank",
  sortingFn: (a, b) => {
    const left = a.original.priorityRank ?? Number.MAX_SAFE_INTEGER;
    const right = b.original.priorityRank ?? Number.MAX_SAFE_INTEGER;
    const rankCompare = left - right;

    if (rankCompare !== 0) {
      return rankCompare;
    }

    return a.original.orderNumber.localeCompare(b.original.orderNumber, undefined, {
      numeric: true,
    });
  },
  cell: ({ row }) => <RankCell rowIndex={row.index} order={row.original} />,
  meta: { className: "w-20" },
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
  rankColumn,
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
    header: "",
    filterFn: multiValueFilter,
    cell: () => null,
    meta: { className: "hidden" },
  },
  {
    id: "salesItems",
    header: ({ column }) => <SortableHeader column={column} label="Sales Items" />,
    sortingFn: (a, b) =>
      parseFloat(a.original.fulfillmentSummary.shortQty) -
      parseFloat(b.original.fulfillmentSummary.shortQty),
    cell: ({ row }) => <OperationalStateCell state={getSalesItemsState(row.original)} />,
    meta: { className: "w-36" },
  },
  {
    id: "productionState",
    header: ({ column }) => <SortableHeader column={column} label="Production" />,
    sortingFn: (a, b) =>
      a.original.openManufacturingOrderCount - b.original.openManufacturingOrderCount,
    cell: ({ row }) => <OperationalStateCell state={getProductionState(row.original)} />,
    meta: { className: "w-40" },
  },
  {
    id: "deliveryState",
    header: ({ column }) => <SortableHeader column={column} label="Delivery" />,
    sortingFn: (a, b) => {
      const doneRank = doneSalesOrderRank(a.original) - doneSalesOrderRank(b.original);
      if (doneRank !== 0) return doneRank;
      return (a.original.requestedDate ?? "").localeCompare(
        b.original.requestedDate ?? ""
      );
    },
    cell: ({ row }) => <OperationalStateCell state={getDeliveryState(row.original)} />,
    meta: { className: "w-40" },
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
  const [statusFilter, setStatusFilter] =
    useState<SalesWorkflowFilterValue>("open");
  const columnVisibility = useMemo(
    () => ({ priorityRank: statusFilter === "open" }),
    [statusFilter]
  );
  const { data: orders = initialData } = useQuery({
    queryKey: ["sales-orders"],
    queryFn: () =>
      apiJson<SalesOrderListRow[]>("/api/sales-orders", {
        fallbackError: "Failed to fetch orders.",
      }),
    initialData,
  });
  const reorderMutation = useMutation({
    mutationFn: async (orderedRows: SalesOrderListRow[]) => {
      await apiJson<{ updated: number }>("/api/sales-orders/priority-ranks", {
        method: "PATCH",
        body: { orderIds: orderedRows.map((row) => row.id) },
        fallbackError: "Failed to reorder sales orders.",
      });
    },
    onMutate: async (orderedRows) => {
      await queryClient.cancelQueries({ queryKey: ["sales-orders"] });
      const previous =
        queryClient.getQueryData<SalesOrderListRow[]>(["sales-orders"]);
      const rankById = new Map(
        orderedRows.map((row, index) => [row.id, index + 1])
      );

      queryClient.setQueryData<SalesOrderListRow[]>(
        ["sales-orders"],
        (current) =>
          current?.map((row) => ({
            ...row,
            priorityRank: rankById.get(row.id) ?? row.priorityRank,
          }))
      );

      return { previous };
    },
    onError: (_error, _orderedRows, context) => {
      queryClient.setQueryData(["sales-orders"], context?.previous);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
    },
  });

  return (
    <DashboardDataTable
      columns={columns}
      columnVisibility={columnVisibility}
      data={orders}
      initialData={initialData}
      queryKey={["sales-orders"]}
      searchAriaLabel="Search orders"
      addHref="/sales/orders/new"
      addAriaLabel="New Order"
      emptyMessage="No sales orders yet."
      toolbarContent={({ table }) => (
        <SalesOrderWorkflowTabs
          table={table}
          onStatusChange={setStatusFilter}
        />
      )}
      initialSorting={[{ id: "priorityRank", desc: false }]}
      initialColumnFilters={[{ id: "status", value: [...OPEN_SALES_STATUSES] }]}
      getRowCanExpand={() => true}
      renderExpandedRow={(row) => <OrderExpandedDetail orderId={row.original.id} />}
      rowReorder={{
        disabled: reorderMutation.isPending,
        enabled: (table) => {
          const selected =
            (table.getColumn("status")?.getFilterValue() as string[] | undefined) ?? [];
          const columnFilters = table.getState().columnFilters;

          return (
            !table.getState().globalFilter &&
            columnFilters.every((filter) => filter.id === "status") &&
            selected.length === OPEN_SALES_STATUSES.length &&
            OPEN_SALES_STATUSES.every((status) => selected.includes(status))
          );
        },
        onReorder: (rows) => reorderMutation.mutate(rows),
      }}
      deleteAction={{
        endpoint: "/api/sales-orders",
        invalidateQueryKeys: [["sales-orders"], ["items"]],
        defaultErrorMessage: "Failed to delete orders.",
        idempotencyKey: "sales-orders-delete",
        confirmTitle: (count) => `Delete ${count} order${count !== 1 ? "s" : ""}?`,
        confirmDescription: (count) =>
          `The selected order${count !== 1 ? "s" : ""} will be soft-deleted.`,
      }}
    />
  );
}

function SalesOrderWorkflowTabs({
  table,
  onStatusChange,
}: {
  table: TanStackTable<SalesOrderListRow>;
  onStatusChange: (status: SalesWorkflowFilterValue) => void;
}) {
  const statusColumn = table.getColumn("status");
  const selected = (statusColumn?.getFilterValue() as string[] | undefined) ?? [];
  const isDone =
    selected.length === DONE_SALES_STATUSES.length &&
    DONE_SALES_STATUSES.every((status) => selected.includes(status));
  const value = isDone ? "done" : "open";
  const statusCounts = statusColumn?.getFacetedUniqueValues();
  const openCount = OPEN_SALES_STATUSES.reduce(
    (sum, status) => sum + (statusCounts?.get(status) ?? 0),
    0
  );
  const doneCount = DONE_SALES_STATUSES.reduce(
    (sum, status) => sum + (statusCounts?.get(status) ?? 0),
    0
  );
  const applyFilter = (nextValue: SalesWorkflowFilterValue) => {
    if (!statusColumn) return;
    onStatusChange(nextValue);
    statusColumn.setFilterValue(
      nextValue === "done" ? [...DONE_SALES_STATUSES] : [...OPEN_SALES_STATUSES]
    );
    table.setSorting([
      { id: nextValue === "open" ? "priorityRank" : "orderNumber", desc: false },
    ]);
  };

  return (
    <ToggleGroup
      type="single"
      size="sm"
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue === "open" || nextValue === "done") {
          applyFilter(nextValue);
        }
      }}
      aria-label="Filter sales orders by workflow"
      className="max-w-full flex-wrap rounded-lg bg-muted p-1"
    >
      <ToggleGroupItem
        value="open"
        aria-label="Show open orders"
        className="gap-1.5"
        onClick={() => applyFilter("open")}
      >
        Open
        <span className="text-muted-foreground">{openCount}</span>
      </ToggleGroupItem>
      <ToggleGroupItem
        value="done"
        aria-label="Show done orders"
        className="gap-1.5"
        onClick={() => applyFilter("done")}
      >
        Done
        <span className="text-muted-foreground">{doneCount}</span>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
