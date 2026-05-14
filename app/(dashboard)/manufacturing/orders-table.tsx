"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type Table as TanStackTable,
} from "@tanstack/react-table";
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
import { DataTableStatusFilter } from "@/components/data-table-status-filter";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
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

type ManufacturingStatusFilterValue =
  (typeof MANUFACTURING_STATUS_FILTER_OPTIONS)[number]["value"];

const INITIAL_SORTING: SortingState = [{ id: "orderNumber", desc: false }];
const INITIAL_COLUMN_FILTERS: ColumnFiltersState = [
  { id: "status", value: ["draft"] },
];

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
  const fillClassName =
    order.status === "completed"
      ? "alloc-progress-fill-supply"
      : "alloc-progress-fill-held";

  return (
    <div className="min-w-32 space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-muted-foreground">{progress.label}</span>
        <span className="font-mono tabular-nums">{progress.percent}%</span>
      </div>
      <div className="alloc-progress-track h-2 rounded-full">
        <div
          className={`${fillClassName} h-full rounded-full transition-[width]`}
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    </div>
  );
}

function RankCell({ rowIndex, order }: { rowIndex: number; order: ManufacturingOrderListRow }) {
  if (order.status !== "released") {
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

const selectColumn: ColumnDef<ManufacturingOrderListRow> = {
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
};

const rankColumn: ColumnDef<ManufacturingOrderListRow> = {
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
};

const orderColumns: ColumnDef<ManufacturingOrderListRow>[] = [
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

const columns: ColumnDef<ManufacturingOrderListRow>[] = [
  selectColumn,
  rankColumn,
  ...orderColumns,
];

function ManufacturingStatusFilter({
  table,
  onStatusChange,
}: {
  table: TanStackTable<ManufacturingOrderListRow>;
  onStatusChange: (status: ManufacturingStatusFilterValue) => void;
}) {
  return (
    <DataTableStatusFilter
      table={table}
      options={MANUFACTURING_STATUS_FILTER_OPTIONS}
      ariaLabel="Filter manufacturing orders by status"
      showAll={false}
      onFilterValueChange={(value) => {
        if (value === "all") return;

        onStatusChange(value);
        table.setSorting([
          { id: value === "released" ? "priorityRank" : "orderNumber", desc: false },
        ]);
      }}
    />
  );
}

export function OrdersTable({
  initialData,
}: {
  initialData: ManufacturingOrderListRow[];
}) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] =
    useState<ManufacturingStatusFilterValue>("draft");
  const columnVisibility = useMemo(
    () => ({ priorityRank: statusFilter === "released" }),
    [statusFilter]
  );
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
      columnVisibility={columnVisibility}
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
        <ManufacturingStatusFilter
          table={table}
          onStatusChange={setStatusFilter}
        />
      )}
      initialSorting={INITIAL_SORTING}
      initialColumnFilters={INITIAL_COLUMN_FILTERS}
      rowReorder={{
        disabled: reorderMutation.isPending,
        enabled: (table) => {
          const selected =
            (table.getColumn("status")?.getFilterValue() as string[] | undefined) ?? [];
          const columnFilters = table.getState().columnFilters;

          return (
            !table.getState().globalFilter &&
            columnFilters.every((filter) => filter.id === "status") &&
            selected.length === 1 &&
            selected[0] === "released"
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
