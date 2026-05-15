"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { type ColumnDef, type Table as TanStackTable } from "@tanstack/react-table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@/lib/client/api";
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
import { TooltipHeader } from "@/components/tooltip-header";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ORDER_TOTAL_TOOLTIP,
  SALES_ORDER_CUSTOMER_TOOLTIP,
  SALES_ORDER_DELIVERY_STATUS_TOOLTIP,
  SALES_ORDER_ITEMS_STATUS_TOOLTIP,
  SALES_ORDER_NOTES_TOOLTIP,
  SALES_ORDER_NUMBER_TOOLTIP,
  SALES_ORDER_PRODUCTION_STATUS_TOOLTIP,
  SALES_ORDER_RANK_TOOLTIP,
  SALES_ORDER_SHIP_DATE_TOOLTIP,
} from "@/lib/tooltip-copy";
import { formatDate, formatPrice } from "@/lib/format";
import {
  DeliveryActionCell,
  ProductionActionCell,
} from "./sales-order-table-action-cells";
import type { SalesOrderListRow } from "./types";

const OPEN_SALES_STATUSES = ["open"] as const;
const DONE_SALES_STATUSES = ["done"] as const;
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
          className="block w-full overflow-hidden text-ellipsis text-left text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
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
  if (order.status === "done") {
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

  return { label: "Not allocated", tone: "destructive" };
}

function readyShipmentCount(order: SalesOrderListRow) {
  return order.shipments.filter((shipment) => shipment.status === "draft").length;
}

function activeShipmentCount(order: SalesOrderListRow) {
  return order.shipments.filter((shipment) => shipment.status !== "cancelled").length;
}

function readyShipmentLabel(order: SalesOrderListRow) {
  const readyCount = readyShipmentCount(order);
  const activeCount = activeShipmentCount(order);

  if (readyCount > 0 && activeCount > 1) {
    return `Ready to ship (${readyCount}/${activeCount})`;
  }

  return "Ready to ship";
}

function hasFullyGroundAllocatedStock(order: SalesOrderListRow) {
  return (
    parseQuantity(order.fulfillmentSummary.remainingQty) > 0 &&
    parseQuantity(order.fulfillmentSummary.shortQty) <= 0 &&
    parseQuantity(order.fulfillmentSummary.productionAllocatedQty) <= 0
  );
}

function shippedSalesQuantity(order: SalesOrderListRow) {
  return order.lines.reduce(
    (sum, line) => sum + parseQuantity(line.shippedQuantity),
    0
  );
}

function SalesItemsActionCell({ order }: { order: SalesOrderListRow }) {
  const state = getSalesItemsState(order);
  const isAllocationLink =
    state.label === "Not allocated" || state.label === "Partial";

  if (!isAllocationLink) {
    return <OperationalStateCell state={state} />;
  }

  return (
    <Link
      href={`/sales/allocation?highlightOrderId=${order.id}`}
      className="block w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Open allocation status"
    >
      <OperationalStateCell
        state={state}
        className="transition-colors hover:border-primary/40 hover:bg-primary/10"
      />
    </Link>
  );
}

function getProductionState(order: SalesOrderListRow): OperationalState {
  if (!order.hasManufacturableLines) {
    return { label: "No production", tone: "muted" };
  }

  if (order.openManufacturingOrders.some((mo) => mo.status === "open")) {
    return { label: "Work in progress", tone: "warning" };
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
  if (order.status === "done") {
    return { label: "Shipped", tone: "success" };
  }

  if (readyShipmentCount(order) > 0) {
    return { label: readyShipmentLabel(order), tone: "success" };
  }

  if (shippedSalesQuantity(order) > 0) {
    return { label: "Partially shipped", tone: "warning" };
  }

  if (
    order.shippingReadiness.state === "ready" &&
    hasFullyGroundAllocatedStock(order)
  ) {
    return { label: "Ready to ship", tone: "success" };
  }

  return { label: "Not shipped", tone: "muted" };
}

function doneSalesOrderRank(order: SalesOrderListRow) {
  if (order.status === "done") return 0;
  return -1;
}

function compareSalesOrderRank(
  left: SalesOrderListRow,
  right: SalesOrderListRow
) {
  const leftRank = left.priorityRank ?? Number.MAX_SAFE_INTEGER;
  const rightRank = right.priorityRank ?? Number.MAX_SAFE_INTEGER;
  const rankCompare = leftRank - rightRank;

  if (rankCompare !== 0) {
    return rankCompare;
  }

  return left.orderNumber.localeCompare(right.orderNumber, undefined, {
    numeric: true,
  });
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
  header: () => (
    <TooltipHeader label="Rank" tooltip={SALES_ORDER_RANK_TOOLTIP} />
  ),
  enableSorting: false,
  cell: ({ row, table }) => {
    const orderedIndex = table
      .getPrePaginationRowModel()
      .rows.findIndex((orderedRow) => orderedRow.id === row.id);

    return (
      <RankCell
        rowIndex={orderedIndex >= 0 ? orderedIndex : row.index}
        order={row.original}
      />
    );
  },
  size: 64,
  minSize: 56,
  maxSize: 110,
  enableResizing: false,
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
    size: 36,
    minSize: 36,
    maxSize: 44,
    enableResizing: false,
  },
  rankColumn,
  {
    accessorKey: "orderNumber",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Order"
        tooltip={SALES_ORDER_NUMBER_TOOLTIP}
      />
    ),
    cell: ({ row }) => (
      <Link
        href={`/sales/orders/${row.original.id}`}
        className="block truncate hover:underline"
      >
        {row.original.orderNumber}
      </Link>
    ),
    size: 115,
    minSize: 100,
  },
  {
    accessorKey: "customerName",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Customer"
        tooltip={SALES_ORDER_CUSTOMER_TOOLTIP}
      />
    ),
    cell: ({ row }) => (
      <span className="block truncate">{row.original.customerName}</span>
    ),
    size: 190,
    minSize: 150,
  },
  {
    accessorKey: "notes",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Notes"
        tooltip={SALES_ORDER_NOTES_TOOLTIP}
      />
    ),
    cell: ({ row }) => <NotesCell notes={row.original.notes} />,
    size: 160,
    minSize: 130,
  },
  {
    accessorKey: "totalAmount",
    header: ({ column }) => (
      <SortableHeader column={column} label="Total" tooltip={ORDER_TOTAL_TOOLTIP} />
    ),
    sortingFn: (a, b) =>
      parseFloat(a.original.totalAmount) - parseFloat(b.original.totalAmount),
    cell: ({ row }) => formatPrice(row.original.totalAmount) ?? "\u2014",
    size: 105,
    minSize: 95,
  },
  {
    accessorKey: "status",
    header: "",
    filterFn: multiValueFilter,
    cell: () => null,
    size: 1,
    minSize: 1,
    maxSize: 1,
    enableResizing: false,
    meta: { className: "hidden" },
  },
  {
    id: "salesItems",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Sales Items"
        tooltip={SALES_ORDER_ITEMS_STATUS_TOOLTIP}
      />
    ),
    sortingFn: (a, b) =>
      parseFloat(a.original.fulfillmentSummary.shortQty) -
      parseFloat(b.original.fulfillmentSummary.shortQty),
    cell: ({ row }) => <SalesItemsActionCell order={row.original} />,
    size: 135,
    minSize: 125,
    meta: { className: "w-36" },
  },
  {
    id: "productionState",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Production"
        tooltip={SALES_ORDER_PRODUCTION_STATUS_TOOLTIP}
      />
    ),
    sortingFn: (a, b) =>
      a.original.openManufacturingOrderCount - b.original.openManufacturingOrderCount,
    cell: ({ row }) => (
      <ProductionActionCell
        order={row.original}
        state={getProductionState(row.original)}
      />
    ),
    size: 140,
    minSize: 130,
    meta: { className: "w-40" },
  },
  {
    id: "deliveryState",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Delivery"
        tooltip={SALES_ORDER_DELIVERY_STATUS_TOOLTIP}
      />
    ),
    sortingFn: (a, b) => {
      const doneRank = doneSalesOrderRank(a.original) - doneSalesOrderRank(b.original);
      if (doneRank !== 0) return doneRank;
      return (a.original.shipDate ?? "").localeCompare(b.original.shipDate ?? "");
    },
    cell: ({ row }) => (
      <DeliveryActionCell
        order={row.original}
        state={getDeliveryState(row.original)}
      />
    ),
    size: 150,
    minSize: 140,
    meta: { className: "w-40" },
  },
  {
    accessorKey: "shipDate",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Ship by"
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
    size: 95,
    minSize: 90,
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
  const displayedOrders = useMemo(() => {
    if (statusFilter !== "open") {
      return orders;
    }

    return [...orders].sort(compareSalesOrderRank);
  }, [orders, statusFilter]);
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
      data={displayedOrders}
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
      initialColumnFilters={[{ id: "status", value: [...OPEN_SALES_STATUSES] }]}
      rowReorder={{
        disabled: reorderMutation.isPending,
        enabled: (table) => {
          const selected =
            (table.getColumn("status")?.getFilterValue() as string[] | undefined) ?? [];
          const columnFilters = table.getState().columnFilters;
          const sorting = table.getState().sorting;

          return (
            !table.getState().globalFilter &&
            sorting.length === 0 &&
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
      ...(nextValue === "done"
        ? [{ id: "orderNumber", desc: false }]
        : []),
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
