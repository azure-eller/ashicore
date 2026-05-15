"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ICellRendererParams, RowDragEndEvent } from "ag-grid-community";
import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { apiJson } from "@/lib/client/api";
import { ERPDataGrid, type ColDef } from "@/components/erp-data-grid";
import { QuantityWithUnit } from "@/components/quantity-with-unit";
import {
  OperationalStateCell,
  type OperationalState,
} from "@/components/operational-state-cell";
import { DateTimeText } from "@/components/date-time-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
const OPEN_MANUFACTURING_STATUSES = ["open"] as const;
const DONE_MANUFACTURING_STATUSES = ["done"] as const;
type ManufacturingWorkflowFilterValue = "open" | "done";

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
      {batchLabel != null ? (
        <Badge variant="outline" className="text-xs font-normal">
          {batchLabel}
        </Badge>
      ) : null}
    </div>
  );
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getOrderProgress(order: ManufacturingOrderListRow) {
  if (order.status === "done") {
    return { percent: 100, label: "Complete" };
  }

  if (order.releasedAt == null) {
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
          : "In production",
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
        : "In production",
  };
}

function ProgressCell({ order }: { order: ManufacturingOrderListRow }) {
  const progress = getOrderProgress(order);
  const fillClassName =
    order.status === "done"
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
  if (order.status === "done") {
    return { label: "Completed", tone: "success" };
  }

  if (order.releasedAt != null) {
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

function ProductionActionCell({ order }: { order: ManufacturingOrderListRow }) {
  const state = getProductionState(order);

  if (order.status !== "open") {
    return <OperationalStateCell state={state} />;
  }

  return (
    <MoStageAction
      orderId={order.id}
      status={order.status}
      trigger={
        <OperationalStateCell
          state={state}
          className="transition-colors hover:border-primary/40 hover:bg-primary/10"
        />
      }
      triggerAriaLabel={`Manufacturing actions for ${order.orderNumber}`}
      releasedAt={order.releasedAt}
    />
  );
}

function doneManufacturingOrderRank(order: ManufacturingOrderListRow) {
  if (order.status === "done") return 0;
  return -1;
}

function compareManufacturingRank(
  left: ManufacturingOrderListRow,
  right: ManufacturingOrderListRow
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

function manufacturingOrderMatchesSearch(
  order: ManufacturingOrderListRow,
  searchValue: string
) {
  const normalizedSearch = searchValue.trim().toLowerCase();

  if (!normalizedSearch) {
    return true;
  }

  return [
    order.orderNumber,
    order.productName,
    order.productMasterName,
    order.productSku,
    order.salesOrderNumber,
    order.salesCustomerName,
    order.plannedQuantity,
    order.actualQuantity,
    order.plannedDate,
    getIngredientState(order).label,
    getProductionState(order).label,
  ].some((value) => value?.toLowerCase().includes(normalizedSearch));
}

function RankCell({
  rowIndex,
  order,
}: {
  rowIndex: number;
  order: ManufacturingOrderListRow;
}) {
  if (!(OPEN_MANUFACTURING_STATUSES as readonly string[]).includes(order.status)) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <div className="flex h-full items-center">
      <span className="w-8 text-[1.0625rem] text-muted-foreground tabular-nums">
        {order.priorityRank ?? rowIndex + 1}
      </span>
    </div>
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
  const [searchValue, setSearchValue] = useState("");
  const [selectedOrders, setSelectedOrders] = useState<ManufacturingOrderListRow[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [hasActiveSort, setHasActiveSort] = useState(false);
  const { data: orders = initialData } = useQuery({
    queryKey: ["manufacturing-orders"],
    queryFn: () =>
      apiJson<ManufacturingOrderListRow[]>("/api/manufacturing-orders", {
        fallbackError: "Failed to fetch manufacturing orders.",
      }),
    initialData,
  });
  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();

    for (const order of orders) {
      counts.set(order.status, (counts.get(order.status) ?? 0) + 1);
    }

    return counts;
  }, [orders]);
  const displayedOrders = useMemo(() => {
    const allowedStatuses =
      statusFilter === "done"
        ? DONE_MANUFACTURING_STATUSES
        : OPEN_MANUFACTURING_STATUSES;
    const filteredOrders = orders.filter(
      (order) =>
        (allowedStatuses as readonly string[]).includes(order.status) &&
        manufacturingOrderMatchesSearch(order, searchValue)
    );

    if (statusFilter === "done") {
      return filteredOrders;
    }

    return [...filteredOrders].sort(compareManufacturingRank);
  }, [orders, searchValue, statusFilter]);
  const reorderEnabled =
    statusFilter === "open" && searchValue.trim() === "" && !hasActiveSort;
  const gridColumns = useMemo<ColDef<ManufacturingOrderListRow>[]>(
    () => [
      {
        colId: "priorityRank",
        field: "priorityRank",
        headerName: "Rank",
        width: 64,
        minWidth: 56,
        maxWidth: 110,
        resizable: false,
        sortable: false,
        rowDrag: reorderEnabled,
        hide: statusFilter !== "open",
        cellRenderer: ({
          data,
          node,
        }: ICellRendererParams<ManufacturingOrderListRow>) =>
          data ? (
            <RankCell rowIndex={node.rowIndex ?? 0} order={data} />
          ) : null,
        getQuickFilterText: () => "",
      },
      {
        field: "orderNumber",
        headerName: "Order",
        width: 150,
        minWidth: 130,
        cellRenderer: ({ data }: ICellRendererParams<ManufacturingOrderListRow>) =>
          data ? (
            <Link
              href={`/manufacturing/orders/${data.id}`}
              className="hover:underline"
            >
              {data.orderNumber}
            </Link>
          ) : null,
        comparator: (left, right) =>
          String(left ?? "").localeCompare(String(right ?? ""), undefined, {
            numeric: true,
          }),
      },
      {
        field: "productName",
        headerName: "Product",
        width: 270,
        minWidth: 200,
        flex: 1.3,
        cellRenderer: ({ data }: ICellRendererParams<ManufacturingOrderListRow>) =>
          data ? <ProductCell order={data} /> : null,
      },
      {
        field: "salesOrderNumber",
        headerName: "Sales Order",
        headerTooltip: MANUFACTURING_SALES_ORDER_TOOLTIP,
        width: 160,
        valueFormatter: ({ value }) => value ?? "—",
      },
      {
        field: "plannedQuantity",
        headerName: "Planned",
        headerTooltip: MANUFACTURING_PLANNED_QTY_TOOLTIP,
        width: 140,
        comparator: (left, right) =>
          parseFloat(String(left ?? "0")) - parseFloat(String(right ?? "0")),
        cellRenderer: ({ data }: ICellRendererParams<ManufacturingOrderListRow>) =>
          data ? <PlannedQuantityCell order={data} /> : null,
      },
      {
        field: "pickProgressPercent",
        headerName: "Progress",
        width: 170,
        minWidth: 150,
        comparator: (_left, _right, leftNode, rightNode) =>
          (leftNode.data ? getOrderProgress(leftNode.data).percent : 0) -
          (rightNode.data ? getOrderProgress(rightNode.data).percent : 0),
        cellRenderer: ({ data }: ICellRendererParams<ManufacturingOrderListRow>) =>
          data ? <ProgressCell order={data} /> : null,
      },
      {
        field: "ingredientReadiness",
        headerName: "Ingredients",
        width: 170,
        minWidth: 150,
        valueGetter: ({ data }) => (data ? getIngredientState(data).label : ""),
        cellRenderer: ({ data }: ICellRendererParams<ManufacturingOrderListRow>) =>
          data ? <OperationalStateCell state={getIngredientState(data)} /> : null,
      },
      {
        colId: "productionState",
        headerName: "Production",
        width: 185,
        minWidth: 160,
        valueGetter: ({ data }) => (data ? getProductionState(data).label : ""),
        cellRenderer: ({ data }: ICellRendererParams<ManufacturingOrderListRow>) =>
          data ? <ProductionActionCell order={data} /> : null,
        comparator: (_left, _right, leftNode, rightNode) => {
          if (!leftNode.data || !rightNode.data) return 0;
          const doneRank =
            doneManufacturingOrderRank(leftNode.data) -
            doneManufacturingOrderRank(rightNode.data);
          if (doneRank !== 0) return doneRank;
          return getProductionState(leftNode.data).label.localeCompare(
            getProductionState(rightNode.data).label
          );
        },
      },
      {
        field: "actualQuantity",
        headerName: "Actual",
        headerTooltip: MANUFACTURING_ACTUAL_QTY_TOOLTIP,
        width: 130,
        cellRenderer: ({ data }: ICellRendererParams<ManufacturingOrderListRow>) =>
          data?.actualQuantity != null ? (
            <QuantityWithUnit
              value={data.actualQuantity}
              unitName={data.unitName}
            />
          ) : (
            "—"
          ),
      },
      {
        field: "plannedDate",
        headerName: "Planned Date",
        width: 150,
        valueFormatter: ({ value }) => formatDate(value as string | null),
      },
      {
        field: "completedAt",
        headerName: "Completed",
        width: 190,
        hide: statusFilter !== "done",
        cellRenderer: ({ data }: ICellRendererParams<ManufacturingOrderListRow>) =>
          data ? <DateTimeText value={data.completedAt} /> : null,
      },
    ],
    [reorderEnabled, statusFilter]
  );
  const reorderMutation = useMutation({
    mutationFn: async (orderedRows: ManufacturingOrderListRow[]) => {
      await apiJson<void>("/api/manufacturing-orders/priority-ranks", {
        method: "PATCH",
        body: { orderIds: orderedRows.map((row) => row.id) },
        fallbackError: "Failed to reorder manufacturing orders.",
      });
    },
    onMutate: async (orderedRows) => {
      await queryClient.cancelQueries({ queryKey: ["manufacturing-orders"] });
      const previous =
        queryClient.getQueryData<ManufacturingOrderListRow[]>([
          "manufacturing-orders",
        ]);
      const rankById = new Map(
        orderedRows.map((row, index) => [row.id, index + 1])
      );

      queryClient.setQueryData<ManufacturingOrderListRow[]>(
        ["manufacturing-orders"],
        (current) => {
          if (!current) return current;

          const currentById = new Map(current.map((row) => [row.id, row]));
          const orderedIds = new Set(orderedRows.map((row) => row.id));
          const reorderedRows = orderedRows.map((row) => ({
            ...(currentById.get(row.id) ?? row),
            priorityRank: rankById.get(row.id) ?? row.priorityRank,
          }));
          const untouchedRows = current.filter((row) => !orderedIds.has(row.id));

          return [...reorderedRows, ...untouchedRows];
        }
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
  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await apiJson<void>("/api/manufacturing-orders", {
        method: "DELETE",
        body: { ids },
        idempotencyKey: "manufacturing-orders-delete",
        fallbackError: "Failed to delete manufacturing orders.",
      });
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      setSelectedOrders([]);
      setDeleteDialogOpen(false);
    },
  });
  const selectedCount = selectedOrders.length;

  return (
    <>
      <ERPDataGrid
        rows={displayedOrders}
        columns={gridColumns}
        searchAriaLabel="Search manufacturing orders"
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        emptyMessage="No manufacturing orders yet."
        enableRowSelection
        onSelectionChange={setSelectedOrders}
        enableManagedRowDrag={reorderEnabled && !reorderMutation.isPending}
        suppressMoveWhenRowDragging
        resetRowDataOnUpdate
        onSortChange={setHasActiveSort}
        onRowDragEnd={(event: RowDragEndEvent<ManufacturingOrderListRow>) => {
          if (!reorderEnabled || reorderMutation.isPending) {
            return;
          }

          const orderedRows: ManufacturingOrderListRow[] = [];
          event.api.forEachNodeAfterFilterAndSort((node) => {
            if (node.data) {
              orderedRows.push(node.data);
            }
          });

          reorderMutation.mutate(orderedRows);
        }}
        toolbarContent={
          <ManufacturingStatusFilter
            value={statusFilter}
            statusCounts={statusCounts}
            onStatusChange={setStatusFilter}
          />
        }
        actions={
          <>
            <Button
              type="button"
              variant="destructive"
              size="icon"
              disabled={selectedCount === 0 || deleteMutation.isPending}
              className="relative"
              aria-label={
                selectedCount > 0
                  ? `Delete ${selectedCount} selected`
                  : "Delete selected"
              }
              onClick={() => setDeleteDialogOpen(true)}
            >
              <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" aria-hidden />
              {selectedCount > 0 ? (
                <span
                  aria-hidden
                  className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground"
                >
                  {selectedCount}
                </span>
              ) : null}
            </Button>
            <Button asChild aria-label="New Order">
              <Link href="/manufacturing/orders/new">
                <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
                New Order
              </Link>
            </Button>
          </>
        }
      />
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedCount} manufacturing order
              {selectedCount !== 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Selected manufacturing orders will be deleted and removed from
              normal views.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending || selectedCount === 0}
              onClick={(event) => {
                event.preventDefault();
                deleteMutation.mutate(selectedOrders.map((order) => order.id));
              }}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ManufacturingStatusFilter({
  value,
  statusCounts,
  onStatusChange,
}: {
  value: ManufacturingWorkflowFilterValue;
  statusCounts: Map<string, number>;
  onStatusChange: (status: ManufacturingWorkflowFilterValue) => void;
}) {
  const openCount = OPEN_MANUFACTURING_STATUSES.reduce(
    (sum, status) => sum + (statusCounts.get(status) ?? 0),
    0
  );
  const doneCount = DONE_MANUFACTURING_STATUSES.reduce(
    (sum, status) => sum + (statusCounts.get(status) ?? 0),
    0
  );

  return (
    <ToggleGroup
      type="single"
      size="sm"
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue === "open" || nextValue === "done") {
          onStatusChange(nextValue);
        }
      }}
      aria-label="Filter manufacturing orders by status"
      className="max-w-full flex-wrap rounded-lg bg-muted p-1"
    >
      <ToggleGroupItem
        value="open"
        aria-label="Show open orders"
        className="gap-1.5"
        onClick={() => onStatusChange("open")}
      >
        Open
        <span className="text-muted-foreground">{openCount}</span>
      </ToggleGroupItem>
      <ToggleGroupItem
        value="done"
        aria-label="Show done orders"
        className="gap-1.5"
        onClick={() => onStatusChange("done")}
      >
        Done
        <span className="text-muted-foreground">{doneCount}</span>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
