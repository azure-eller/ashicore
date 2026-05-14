"use client";

import Link from "next/link";
import { type ColumnDef, type Table as TanStackTable } from "@tanstack/react-table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { multiValueFilter } from "@/components/filterable-header";
import { QuantityWithUnit } from "@/components/quantity-with-unit";
import { SortableHeader } from "@/components/sortable-header";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  DashboardDataTable,
  DashboardDataTableDragHandle,
} from "@/components/dashboard-data-table";
import { DateTimeText } from "@/components/date-time-text";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDate } from "@/lib/format";
import {
  MANUFACTURING_ACTUAL_QTY_TOOLTIP,
  MANUFACTURING_ORDER_STATUS_COLUMN_TOOLTIP,
  MANUFACTURING_PLANNED_QTY_TOOLTIP,
  MANUFACTURING_SALES_ORDER_TOOLTIP,
} from "@/lib/tooltip-copy";
import { MoStageAction } from "./mo-stage-action";
import { ManufacturingOrderStatusBadge } from "./status-badge";
import type { ManufacturingOrderListRow } from "./types";

const BADGE_VARIANTS = ["secondary", "outline", "default"] as const;

const MANUFACTURING_STATUS_FILTER_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "released", label: "Released" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

const OPEN_MANUFACTURING_STATUSES = ["draft", "released"] as const;

function AttributeBadges({ attrs }: { attrs: string[] }) {
  return attrs.map((attr, index) => (
    <Badge
      key={`${attr}-${index}`}
      variant={BADGE_VARIANTS[index % BADGE_VARIANTS.length]}
      className="text-xs font-normal"
    >
      {attr}
    </Badge>
  ));
}

function ProductCell({ order }: { order: ManufacturingOrderListRow }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="truncate">{order.productMasterName}</span>
      <AttributeBadges attrs={order.productAttrs} />
    </div>
  );
}

function PlannedQuantityCell({ order }: { order: ManufacturingOrderListRow }) {
  const batchLabel =
    order.manufacturingMode === "batch" && order.numberOfBatches != null
      ? `${order.numberOfBatches}b`
      : null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <QuantityWithUnit value={order.plannedQuantity} unitName={order.unitName} />
      {batchLabel != null && (
        <Badge variant="outline" className="text-xs font-normal">
          {batchLabel}
        </Badge>
      )}
    </div>
  );
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getOrderProgress(order: ManufacturingOrderListRow) {
  if (order.status === "completed") {
    return { percent: 100, label: "Complete" };
  }

  if (order.status === "cancelled") {
    return { percent: 0, label: "Cancelled" };
  }

  if (order.status === "draft") {
    return { percent: 0, label: "Draft" };
  }

  if (order.manufacturingMode === "batch") {
    const totalBatchCount = order.numberOfBatches ?? 0;
    const percent =
      totalBatchCount > 0
        ? (order.completedBatchCount / totalBatchCount) * 100
        : order.pickProgressPercent;

    return {
      percent: clampPercent(percent),
      label:
        totalBatchCount > 0
          ? `${order.completedBatchCount}/${totalBatchCount} batches`
          : "Released",
    };
  }

  if (order.pickProgressStatus === "picked") {
    return { percent: 75, label: "Picked" };
  }

  return {
    percent: clampPercent(order.pickProgressPercent),
    label:
      order.pickProgressPercent > 0
        ? `${clampPercent(order.pickProgressPercent)}% picked`
        : "Released",
  };
}

function ProgressCell({ order }: { order: ManufacturingOrderListRow }) {
  const progress = getOrderProgress(order);

  return (
    <div className="min-w-32 space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-muted-foreground">{progress.label}</span>
        <span className="font-mono tabular-nums">{progress.percent}%</span>
      </div>
      <div className="alloc-progress-track h-2 rounded-full">
        <div
          className="alloc-progress-fill-held h-full rounded-full transition-[width]"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    </div>
  );
}

function RankCell({ rowIndex, order }: { rowIndex: number; order: ManufacturingOrderListRow }) {
  return (
    <div className="flex items-center gap-1.5">
      <DashboardDataTableDragHandle label={`Reorder ${order.orderNumber}`} />
      <span className="w-6 text-sm text-muted-foreground tabular-nums">
        {order.priorityRank ?? rowIndex + 1}
      </span>
    </div>
  );
}

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
    cell: ({ row }) => (
      <RankCell rowIndex={row.index} order={row.original} />
    ),
    meta: { className: "w-20" },
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
    cell: ({ row }) => <ProductCell order={row.original} />,
  },
  {
    accessorKey: "salesOrderNumber",
    header: () => (
      <TooltipHeader label="Sales Order" tooltip={MANUFACTURING_SALES_ORDER_TOOLTIP} />
    ),
    cell: ({ row }) => row.original.salesOrderNumber ?? "\u2014",
  },
  {
    accessorKey: "plannedQuantity",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Planned"
        tooltip={MANUFACTURING_PLANNED_QTY_TOOLTIP}
      />
    ),
    sortingFn: (a, b) =>
      parseFloat(a.original.plannedQuantity) - parseFloat(b.original.plannedQuantity),
    cell: ({ row }) => <PlannedQuantityCell order={row.original} />,
  },
  {
    accessorKey: "pickProgressPercent",
    header: ({ column }) => <SortableHeader column={column} label="Progress" />,
    sortingFn: (a, b) =>
      getOrderProgress(a.original).percent - getOrderProgress(b.original).percent,
    cell: ({ row }) => <ProgressCell order={row.original} />,
    meta: { className: "w-40" },
  },
  {
    accessorKey: "actualQuantity",
    header: () => (
      <TooltipHeader label="Actual" tooltip={MANUFACTURING_ACTUAL_QTY_TOOLTIP} />
    ),
    cell: ({ row }) =>
      row.original.actualQuantity != null
        ? (
            <QuantityWithUnit
              value={row.original.actualQuantity}
              unitName={row.original.unitName}
            />
          )
        : "\u2014",
  },
  {
    accessorKey: "plannedDate",
    header: ({ column }) => <SortableHeader column={column} label="Planned Date" />,
    sortingFn: (a, b) => {
      const dateCompare = (a.original.plannedDate ?? "").localeCompare(
        b.original.plannedDate ?? ""
      );

      if (dateCompare !== 0) {
        return dateCompare;
      }

      return a.original.orderNumber.localeCompare(b.original.orderNumber, undefined, {
        numeric: true,
      });
    },
    cell: ({ row }) => formatDate(row.original.plannedDate),
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Status"
        tooltip={MANUFACTURING_ORDER_STATUS_COLUMN_TOOLTIP}
      />
    ),
    filterFn: multiValueFilter,
    cell: ({ row }) => <ManufacturingOrderStatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "completedAt",
    header: ({ column }) => <SortableHeader column={column} label="Completed" />,
    cell: ({ row }) => <DateTimeText value={row.original.completedAt} />,
  },
  {
    id: "action",
    header: "",
    cell: ({ row }) => (
      <MoStageAction orderId={row.original.id} status={row.original.status} />
    ),
    enableSorting: false,
  },
];

export function OrdersTable({
  initialData,
}: {
  initialData: ManufacturingOrderListRow[];
}) {
  const queryClient = useQueryClient();
  const reorderMutation = useMutation({
    mutationFn: async (orderedRows: ManufacturingOrderListRow[]) => {
      const response = await fetch("/api/manufacturing-orders/priority-ranks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: orderedRows.map((row) => row.id) }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to reorder manufacturing orders.");
      }
    },
    onMutate: async (orderedRows) => {
      await queryClient.cancelQueries({ queryKey: ["manufacturing-orders"] });
      const previous =
        queryClient.getQueryData<ManufacturingOrderListRow[]>(["manufacturing-orders"]);
      const rankById = new Map(
        orderedRows.map((row, index) => [row.id, index + 1])
      );

      queryClient.setQueryData<ManufacturingOrderListRow[]>(
        ["manufacturing-orders"],
        (current) =>
          current?.map((row) => ({
            ...row,
            priorityRank: rankById.get(row.id) ?? row.priorityRank,
          }))
      );

      return { previous };
    },
    onError: (_error, _orderedRows, context) => {
      queryClient.setQueryData(["manufacturing-orders"], context?.previous);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
    },
  });

  return (
    <DashboardDataTable
      columns={columns}
      initialData={initialData}
      queryKey={["manufacturing-orders"]}
      queryFn={async () => {
        const response = await fetch("/api/manufacturing-orders");
        if (!response.ok) {
          throw new Error("Failed to fetch manufacturing orders");
        }

        return response.json();
      }}
      searchAriaLabel="Search manufacturing orders"
      addHref="/manufacturing/orders/new"
      addAriaLabel="New Order"
      emptyMessage="No manufacturing orders yet."
      toolbarContent={({ table }) => (
        <ManufacturingOrderStatusTabs table={table} />
      )}
      initialSorting={[{ id: "priorityRank", desc: false }]}
      initialColumnFilters={[{ id: "status", value: [...OPEN_MANUFACTURING_STATUSES] }]}
      rowReorder={{
        disabled: reorderMutation.isPending,
        enabled: (table) => {
          const selected =
            (table.getColumn("status")?.getFilterValue() as string[] | undefined) ?? [];
          const columnFilters = table.getState().columnFilters;

          return (
            !table.getState().globalFilter &&
            columnFilters.every((filter) => filter.id === "status") &&
            selected.length === OPEN_MANUFACTURING_STATUSES.length &&
            OPEN_MANUFACTURING_STATUSES.every((status) => selected.includes(status))
          );
        },
        onReorder: (orderedRows) => reorderMutation.mutate(orderedRows),
      }}
      deleteAction={{
        endpoint: "/api/manufacturing-orders",
        invalidateQueryKeys: [["manufacturing-orders"], ["items"]],
        defaultErrorMessage: "Failed to delete manufacturing orders.",
        confirmTitle: (count) =>
          `Delete ${count} manufacturing order${count !== 1 ? "s" : ""}?`,
        confirmDescription: () =>
          "Draft, completed, or cancelled orders will be soft-deleted and removed from normal views. Released orders must be cancelled first.",
      }}
    />
  );
}

function ManufacturingOrderStatusTabs({
  table,
}: {
  table: TanStackTable<ManufacturingOrderListRow>;
}) {
  const statusColumn = table.getColumn("status");
  const selected = (statusColumn?.getFilterValue() as string[] | undefined) ?? [];
  const value =
    selected.length === 2 &&
    selected.includes("draft") &&
    selected.includes("released")
      ? "open"
      : selected.length === 1
        ? selected[0]
        : "all";

  const statusCounts = statusColumn?.getFacetedUniqueValues();
  const openCount =
    (statusCounts?.get("draft") ?? 0) + (statusCounts?.get("released") ?? 0);

  return (
    <ToggleGroup
      type="single"
      size="sm"
      value={value}
      onValueChange={(nextValue) => {
        if (!statusColumn || !nextValue) return;
        if (nextValue === "all") {
          statusColumn.setFilterValue(undefined);
          return;
        }
        if (nextValue === "open") {
          statusColumn.setFilterValue([...OPEN_MANUFACTURING_STATUSES]);
          return;
        }
        statusColumn.setFilterValue([nextValue]);
      }}
      aria-label="Filter manufacturing orders by status"
      className="max-w-full flex-wrap rounded-lg bg-muted p-1"
    >
      <ToggleGroupItem value="open" aria-label="Show open orders" className="gap-1.5">
        Open
        <span className="text-muted-foreground">{openCount}</span>
      </ToggleGroupItem>
      {MANUFACTURING_STATUS_FILTER_OPTIONS.filter(
        (option) => option.value !== "draft" && option.value !== "released"
      ).map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          aria-label={`Show ${option.label} orders`}
          className="gap-1.5"
        >
          {option.label}
          <span className="text-muted-foreground">
            {statusCounts?.get(option.value) ?? 0}
          </span>
        </ToggleGroupItem>
      ))}
      <ToggleGroupItem value="all" aria-label="Show all orders" className="gap-1.5">
        All
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
