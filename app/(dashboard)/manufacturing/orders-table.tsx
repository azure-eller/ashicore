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
import {
  OperationalStateCell,
  type OperationalState,
} from "@/components/operational-state-cell";
import { DateTimeText } from "@/components/date-time-text";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDate } from "@/lib/format";
import {
  MANUFACTURING_ACTUAL_QTY_TOOLTIP,
  MANUFACTURING_PLANNED_QTY_TOOLTIP,
  MANUFACTURING_SALES_ORDER_TOOLTIP,
} from "@/lib/tooltip-copy";
import { MoStageAction } from "./mo-stage-action";
import type { ManufacturingOrderListRow } from "./types";

const BADGE_VARIANTS = ["secondary", "outline", "default"] as const;

const OPEN_MANUFACTURING_STATUSES = ["draft", "released"] as const;
const DONE_MANUFACTURING_STATUSES = ["completed", "cancelled"] as const;
type ManufacturingWorkflowFilterValue = "open" | "done";

const INITIAL_SORTING: SortingState = [{ id: "priorityRank", desc: false }];
const INITIAL_COLUMN_FILTERS: ColumnFiltersState = [
  { id: "status", value: [...OPEN_MANUFACTURING_STATUSES] },
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
    return { percent: 0, label: "Not started" };
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

function getIngredientState(order: ManufacturingOrderListRow): OperationalState {
  if (order.status === "cancelled") {
    return { label: "Cancelled", tone: "destructive" };
  }

  if (order.ingredientReadiness === "picked") {
    return { label: "Picked", tone: "success" };
  }

  if (order.ingredientReadiness === "picking") {
    return { label: "Picking", tone: "warning" };
  }

  if (order.ingredientReadiness === "in_stock") {
    return { label: "In stock", tone: "success" };
  }

  if (order.ingredientReadiness === "expected") {
    return { label: "Expected", tone: "warning" };
  }

  return { label: "Not available", tone: "destructive" };
}

function getProductionState(order: ManufacturingOrderListRow): OperationalState {
  if (order.status === "completed") {
    return { label: "Completed", tone: "success" };
  }

  if (order.status === "cancelled") {
    return { label: "Cancelled", tone: "destructive" };
  }

  if (order.status === "released") {
    if (
      order.pickProgressStatus === "in_progress" ||
      order.pickProgressStatus === "picked" ||
      order.completedBatchCount > 0
    ) {
      return { label: "Work in progress", tone: "warning" };
    }

    return { label: "Not started", tone: "muted" };
  }

  return { label: "Not started", tone: "muted" };
}

function doneManufacturingOrderRank(order: ManufacturingOrderListRow) {
  if (order.status === "cancelled") return 1;
  if (order.status === "completed") return 0;
  return -1;
}

function RankCell({ rowIndex, order }: { rowIndex: number; order: ManufacturingOrderListRow }) {
  if (!(OPEN_MANUFACTURING_STATUSES as readonly string[]).includes(order.status)) {
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
    accessorKey: "ingredientReadiness",
    header: ({ column }) => <SortableHeader column={column} label="Ingredients" />,
    sortingFn: (a, b) =>
      getIngredientState(a.original).label.localeCompare(
        getIngredientState(b.original).label
      ),
    cell: ({ row }) => <OperationalStateCell state={getIngredientState(row.original)} />,
    meta: { className: "w-40" },
  },
  {
    id: "productionState",
    header: ({ column }) => <SortableHeader column={column} label="Production" />,
    sortingFn: (a, b) => {
      const doneRank =
        doneManufacturingOrderRank(a.original) -
        doneManufacturingOrderRank(b.original);
      if (doneRank !== 0) return doneRank;
      return getProductionState(a.original).label.localeCompare(
        getProductionState(b.original).label
      );
    },
    cell: ({ row }) => <OperationalStateCell state={getProductionState(row.original)} />,
    meta: { className: "w-44" },
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
    header: "",
    filterFn: multiValueFilter,
    cell: () => null,
    meta: { className: "hidden" },
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
  onStatusChange: (status: ManufacturingWorkflowFilterValue) => void;
}) {
  const statusColumn = table.getColumn("status");
  const selected = (statusColumn?.getFilterValue() as string[] | undefined) ?? [];
  const isDone =
    selected.length === DONE_MANUFACTURING_STATUSES.length &&
    DONE_MANUFACTURING_STATUSES.every((status) => selected.includes(status));
  const value: ManufacturingWorkflowFilterValue = isDone ? "done" : "open";
  const statusCounts = statusColumn?.getFacetedUniqueValues();
  const openCount =
    (statusCounts?.get("draft") ?? 0) + (statusCounts?.get("released") ?? 0);
  const doneCount =
    (statusCounts?.get("completed") ?? 0) + (statusCounts?.get("cancelled") ?? 0);

  const applyFilter = (nextValue: ManufacturingWorkflowFilterValue) => {
    if (!statusColumn) return;
    onStatusChange(nextValue);
    statusColumn.setFilterValue(
      nextValue === "open"
        ? [...OPEN_MANUFACTURING_STATUSES]
        : [...DONE_MANUFACTURING_STATUSES]
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
      aria-label="Filter manufacturing orders by status"
      className="max-w-full flex-wrap rounded-lg bg-muted p-1"
    >
      <ToggleGroupItem
        value="open"
        aria-label="Show open orders"
        className="gap-1.5 data-[state=on]:bg-background data-[state=on]:shadow-xs"
        onClick={() => applyFilter("open")}
      >
        Open
        <span className="text-muted-foreground">{openCount}</span>
      </ToggleGroupItem>
      <ToggleGroupItem
        value="done"
        aria-label="Show done orders"
        className="gap-1.5 data-[state=on]:bg-background data-[state=on]:shadow-xs"
        onClick={() => applyFilter("done")}
      >
        Done
        <span className="text-muted-foreground">{doneCount}</span>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

export function OrdersTable({
  initialData,
}: {
  initialData: ManufacturingOrderListRow[];
}) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] =
    useState<ManufacturingWorkflowFilterValue>("open");
  const columnVisibility = useMemo(
    () => ({ priorityRank: statusFilter === "open" }),
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
          const sorting = table.getState().sorting;

          return (
            !table.getState().globalFilter &&
            sorting.length === 1 &&
            sorting[0]?.id === "priorityRank" &&
            sorting[0]?.desc === false &&
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
          "Completed or cancelled orders will be soft-deleted and removed from normal views. Open orders must be cancelled first.",
      }}
    />
  );
}
