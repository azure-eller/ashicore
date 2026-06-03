"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GridApi, ICellRendererParams } from "ag-grid-community";
import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { apiJson } from "@/lib/client/api";
import { usePersistentViewState } from "@/lib/client/use-persistent-view-state";
import {
  ERPDataGrid,
  type ColDef,
  type ERPGridPersistentState,
} from "@/components/erp-data-grid";
import { SelectionCountBadge } from "@/components/selection-count-badge";
import {
  WorkflowStatusFilter,
  type WorkflowStatusFilterValue,
} from "@/components/workflow-status-filter";
import { QuantityWithUnit } from "@/components/quantity-with-unit";
import { DateTimeText } from "@/components/date-time-text";
import { fulfillmentStatusBlockTone } from "@/components/fulfillment-status-block";
import { clampProgressPercent, ProgressMeter } from "@/components/progress-meter";
import { StatusDetailMenuTable } from "@/components/status-detail-menu-table";
import { AttributeBadges } from "@/components/attribute-badges";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBlock } from "@/components/ui/status-block";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { formatDate, formatQuantity } from "@/lib/format";
import {
  getIngredientsDisplayState,
  getProductionDisplayState,
  type FulfillmentDisplayState,
  type SalesIngredientsFulfillmentState,
  type SalesProductionFulfillmentState,
} from "@/lib/sales/fulfillment-status";
import {
  MANUFACTURING_ACTUAL_QTY_TOOLTIP,
  MANUFACTURING_PLANNED_QTY_TOOLTIP,
  MANUFACTURING_SALES_ORDER_TOOLTIP,
} from "@/lib/tooltip-copy";
import type { ManufacturingOrdersPreference } from "@/lib/view-preferences";
import { OrderStatusControl } from "@/components/card-page/order-status-control";
import {
  isManufacturingStatusDisabled,
  manufacturingOrderStatusConfig,
} from "@/components/card-page/order-status-configs";
import type { ManufacturingOrderListRow } from "./types";

const OPEN_MANUFACTURING_STATUSES = ["open"] as const;
const DONE_MANUFACTURING_STATUSES = ["done"] as const;
const MANUFACTURING_ORDERS_VIEW_KEY = "manufacturing.orders";
const DEFAULT_MANUFACTURING_ORDERS_PREFERENCE: ManufacturingOrdersPreference = {
  version: 1,
};
type ManufacturingWorkflowFilterValue = WorkflowStatusFilterValue;
const ALL_RESOURCES_FILTER = "__all";
const NO_RESOURCE_FILTER = "__none";

function keepManufacturingRankVisible(
  grid: ERPGridPersistentState | undefined
): ERPGridPersistentState | undefined {
  if (!grid) return undefined;

  const hiddenColIds = grid.columnVisibility?.hiddenColIds;
  if (!hiddenColIds?.includes("priorityRank")) {
    return grid;
  }

  return {
    ...grid,
    columnVisibility: {
      ...grid.columnVisibility,
      hiddenColIds: hiddenColIds.filter((colId) => colId !== "priorityRank"),
    },
  };
}

function ProductCell({ order }: { order: ManufacturingOrderListRow }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="truncate">{order.productMasterName}</span>
      <AttributeBadges attrs={order.productAttrs} />
    </div>
  );
}

function getResourceFilterKey(
  resource: ManufacturingOrderListRow["operationResources"][number]
) {
  return resource.id ?? `${resource.type}:${resource.name}`;
}

function getOrderResourceFilterKeys(order: ManufacturingOrderListRow) {
  if (order.operationResources.length === 0) {
    return [NO_RESOURCE_FILTER];
  }

  return order.operationResources.map(getResourceFilterKey);
}

function PlannedQuantityCell({ order }: { order: ManufacturingOrderListRow }) {
  return (
    <div className="flex min-w-0 items-center">
      <QuantityWithUnit value={order.plannedQuantity} unitName={order.unitName} />
    </div>
  );
}

function getOutputProgress(order: ManufacturingOrderListRow) {
  const planned = Number(order.plannedQuantity);
  const actual = Number(order.actualQuantity ?? "0");
  if (!Number.isFinite(planned) || planned <= 0 || !Number.isFinite(actual) || actual <= 0) {
    return null;
  }

  return {
    percent: clampProgressPercent((actual / planned) * 100),
    label: `${formatQuantity(order.actualQuantity ?? "0")}/${formatQuantity(order.plannedQuantity)} ${order.unitName} produced`,
  };
}

function getOrderProgress(order: ManufacturingOrderListRow) {
  if (order.status === "done") {
    return { percent: 100, label: "Complete" };
  }

  const outputProgress = getOutputProgress(order);

  if (order.manufacturingMode === "batch") {
    const totalBatchCount = order.numberOfBatches ?? 0;
    const batchPercent =
      totalBatchCount > 0
        ? (order.completedBatchCount / totalBatchCount) * 100
        : order.pickProgressPercent;
    const outputPercent = outputProgress?.percent ?? 0;
    const useOutputProgress = outputProgress != null && outputPercent > batchPercent;

    return {
      percent: clampProgressPercent(useOutputProgress ? outputPercent : batchPercent),
      label: useOutputProgress
        ? outputProgress.label
        : totalBatchCount > 0
          ? `${order.completedBatchCount}/${totalBatchCount} batches`
          : "Progress",
    };
  }

  if (outputProgress) {
    return outputProgress;
  }

  if (order.pickProgressStatus === "picked") {
    return { percent: 75, label: "Picked" };
  }

  return {
    percent: clampProgressPercent(order.pickProgressPercent),
    label:
      order.pickProgressPercent > 0
        ? `${clampProgressPercent(order.pickProgressPercent)}% picked`
        : "Progress",
  };
}

function ProductionProgressBar({ order }: { order: ManufacturingOrderListRow }) {
  const progress = getOrderProgress(order);
  const batchCount =
    order.manufacturingMode === "batch" ? order.numberOfBatches ?? 0 : 0;
  const actualQuantity = Number(order.actualQuantity ?? "0");
  const showBatchSegments =
    batchCount > 1 &&
    (!Number.isFinite(actualQuantity) ||
      actualQuantity <= 0 ||
      progress.percent <= clampProgressPercent(
        (order.completedBatchCount / batchCount) * 100
      ));

  return (
    <ProgressMeter
      label={progress.label}
      percent={progress.percent}
      segmentCount={showBatchSegments ? batchCount : undefined}
      completedSegmentCount={order.completedBatchCount}
    />
  );
}

function getIngredientState(order: ManufacturingOrderListRow): FulfillmentDisplayState {
  const ingredientState: SalesIngredientsFulfillmentState =
    order.ingredientReadiness === "picking"
      ? "in_stock"
      : order.ingredientReadiness;
  return getIngredientsDisplayState(ingredientState, order.ingredientExpectedDate);
}

function getProductionState(order: ManufacturingOrderListRow): FulfillmentDisplayState {
  let productionState: SalesProductionFulfillmentState = "not_started";

  if (order.status === "done") {
    productionState = "done";
  } else if (
    Number(order.actualQuantity ?? 0) > 0 ||
    order.startedAt != null ||
    order.pickProgressStatus === "in_progress" ||
    order.pickProgressStatus === "picked" ||
    order.completedBatchCount > 0
  ) {
    productionState = "in_progress";
  }

  return getProductionDisplayState(productionState);
}

function IngredientsStatusCell({ order }: { order: ManufacturingOrderListRow }) {
  const state = getIngredientState(order);
  const rows = order.ingredientCoverage.map((row) => ({
    id: row.itemId,
    item: row.itemName,
    needed: formatQuantity(row.needed),
    available: formatQuantity(row.available),
    expected: formatQuantity(row.expected),
    short: Number(row.available) + Number(row.expected) < Number(row.needed),
  }));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <StatusBlock
          tone={fulfillmentStatusBlockTone[state.tone]}
          actionable
          actionVariant="button"
          onClick={(event) => event.stopPropagation()}
          aria-label={`Ingredients: ${state.label}`}
        >
          {state.label}
        </StatusBlock>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[420px]">
        <DropdownMenuLabel>Ingredients</DropdownMenuLabel>
        <StatusDetailMenuTable emptyMessage="No ingredient demand." rows={rows} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProductionActionCell({ order }: { order: ManufacturingOrderListRow }) {
  const queryClient = useQueryClient();

  if (order.status === "done") {
    return (
      <StatusBlock tone="success" aria-label="Production: Done">
        Done
      </StatusBlock>
    );
  }

  return (
    <OrderStatusControl
      config={manufacturingOrderStatusConfig}
      ctx={{ order }}
      disabled={isManufacturingStatusDisabled(order)}
      footer={<ProductionProgressBar order={order} />}
      actionVariant="button"
      onChanged={() => {
        void queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
        void queryClient.invalidateQueries({ queryKey: ["items"] });
      }}
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
    ...order.operationResources.map((resource) => resource.name),
  ].some((value) => value?.toLowerCase().includes(normalizedSearch));
}

type ManufacturingResourceFilterOption = {
  value: string;
  label: string;
  count: number;
};

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
      <span className="w-(--space-16) text-muted-foreground tabular-nums">
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
  const gridApiRef = useRef<GridApi<ManufacturingOrderListRow> | null>(null);
  const [statusFilter, setStatusFilter] =
    useState<ManufacturingWorkflowFilterValue>("open");
  const [resourceFilter, setResourceFilter] = useState(ALL_RESOURCES_FILTER);
  const [searchValue, setSearchValue] = useState("");
  const [selectedOrders, setSelectedOrders] = useState<ManufacturingOrderListRow[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [hasActiveSort, setHasActiveSort] = useState(false);
  const [ordersPreference, setOrdersPreference] = usePersistentViewState({
    viewKey: MANUFACTURING_ORDERS_VIEW_KEY,
    defaultValue: DEFAULT_MANUFACTURING_ORDERS_PREFERENCE,
  });
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
  const statusFilteredOrders = useMemo(() => {
    const allowedStatuses =
      statusFilter === "done"
        ? DONE_MANUFACTURING_STATUSES
        : OPEN_MANUFACTURING_STATUSES;
    return orders.filter(
      (order) =>
        (allowedStatuses as readonly string[]).includes(order.status) &&
        manufacturingOrderMatchesSearch(order, searchValue)
    );
  }, [orders, searchValue, statusFilter]);
  const resourceOptions = useMemo<ManufacturingResourceFilterOption[]>(() => {
    const optionByValue = new Map<string, ManufacturingResourceFilterOption>();

    for (const order of statusFilteredOrders) {
      if (order.operationResources.length === 0) {
        const existing = optionByValue.get(NO_RESOURCE_FILTER);
        optionByValue.set(NO_RESOURCE_FILTER, {
          value: NO_RESOURCE_FILTER,
          label: "No resource",
          count: (existing?.count ?? 0) + 1,
        });
        continue;
      }

      for (const resource of order.operationResources) {
        const value = getResourceFilterKey(resource);
        const existing = optionByValue.get(value);
        optionByValue.set(value, {
          value,
          label: resource.name,
          count: (existing?.count ?? 0) + 1,
        });
      }
    }

    return [...optionByValue.values()].sort((left, right) => {
      if (left.value === NO_RESOURCE_FILTER) return 1;
      if (right.value === NO_RESOURCE_FILTER) return -1;
      return left.label.localeCompare(right.label, undefined, { numeric: true });
    });
  }, [statusFilteredOrders]);
  const effectiveResourceFilter =
    resourceFilter === ALL_RESOURCES_FILTER ||
    resourceOptions.some((option) => option.value === resourceFilter)
      ? resourceFilter
      : ALL_RESOURCES_FILTER;
  const displayedOrders = useMemo(() => {
    const filteredOrders =
      effectiveResourceFilter === ALL_RESOURCES_FILTER
        ? statusFilteredOrders
        : statusFilteredOrders.filter((order) =>
            getOrderResourceFilterKeys(order).includes(effectiveResourceFilter)
          );

    if (statusFilter === "done") {
      return filteredOrders;
    }

    return [...filteredOrders].sort(compareManufacturingRank);
  }, [effectiveResourceFilter, statusFilter, statusFilteredOrders]);
  const hasSearchFilter = searchValue.trim().length > 0;
  const reorderAvailable =
    statusFilter === "open" &&
    !hasSearchFilter &&
    effectiveResourceFilter === ALL_RESOURCES_FILTER &&
    !hasActiveSort;
  const persistedGridState = useMemo(
    () => keepManufacturingRankVisible(ordersPreference.grid),
    [ordersPreference.grid]
  );
  const clearSort = useCallback(() => {
    gridApiRef.current?.applyColumnState({
      defaultState: { sort: null },
    });
    setHasActiveSort(false);
  }, []);
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
        rowDrag: reorderAvailable,
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
              href={`/manufacturing/order/${data.id}`}
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
        width: 156,
        minWidth: 150,
        comparator: (left, right) =>
          parseFloat(String(left ?? "0")) - parseFloat(String(right ?? "0")),
        cellRenderer: ({ data }: ICellRendererParams<ManufacturingOrderListRow>) =>
          data ? <PlannedQuantityCell order={data} /> : null,
      },
      {
        field: "ingredientReadiness",
        headerName: "Ingredients",
        width: 170,
        minWidth: 150,
        cellClass: "statusBlockCell",
        valueGetter: ({ data }) => (data ? getIngredientState(data).label : ""),
        cellRenderer: ({ data }: ICellRendererParams<ManufacturingOrderListRow>) =>
          data ? <IngredientsStatusCell order={data} /> : null,
      },
      {
        colId: "productionState",
        headerName: "Production",
        width: 205,
        minWidth: 180,
        cellClass: "statusBlockCell",
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
        headerName: "Production deadline",
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
    [reorderAvailable, statusFilter]
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
        enableManagedRowDrag={reorderAvailable}
        suppressMoveWhenRowDragging
        relaxResizableMaxWidth
        onGridReady={(event) => {
          gridApiRef.current = event.api;
        }}
        onSortChange={setHasActiveSort}
        persistedGridState={persistedGridState}
        onPersistedGridStateChange={(grid) => {
          setOrdersPreference((current) => ({
            ...current,
            grid: keepManufacturingRankVisible(grid),
          }));
        }}
        onManagedRowDragReorder={(orderedRows) => {
          if (!reorderAvailable || reorderMutation.isPending) {
            return;
          }

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
            <ManufacturingResourceFilter
              value={effectiveResourceFilter}
              options={resourceOptions}
              orderCount={statusFilteredOrders.length}
              onValueChange={setResourceFilter}
            />
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
              <SelectionCountBadge count={selectedCount} />
            </Button>
            <Button asChild aria-label="New Order">
              <Link href="/manufacturing/order">
                <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
                New Order
              </Link>
            </Button>
          </>
        }
        statusBarContent={
          <>
            <span>
              {displayedOrders.length} of {orders.length} rows
            </span>
            <div className="flex-1" />
            <button
              type="button"
              className="hover:text-foreground"
              aria-label={
                hasActiveSort
                  ? "Reset sort to reorder manufacturing orders"
                  : "Manufacturing orders sorted by rank"
              }
              onClick={clearSort}
            >
              Sort: {hasActiveSort ? "Custom" : "Rank ↑"}
            </button>
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
              Selected manufacturing orders will be removed from normal views.
              Picked or reserved inventory will be released. Batch orders with
              completed batches keep completed output and consumed ingredients
              as production history while remaining work is cancelled.
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

function ManufacturingResourceFilter({
  value,
  options,
  orderCount,
  onValueChange,
}: {
  value: string;
  options: ManufacturingResourceFilterOption[];
  orderCount: number;
  onValueChange: (value: string) => void;
}) {
  if (options.length === 0) {
    return null;
  }

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        size="sm"
        aria-label="Filter manufacturing orders by resource"
        className="max-w-[220px] bg-background"
      >
        <SelectValue placeholder="All resources" />
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value={ALL_RESOURCES_FILTER}>
          All resources
          <span className="font-mono text-[length:var(--text-2xs)] text-muted-foreground tabular-nums">
            {orderCount}
          </span>
        </SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
            <span className="font-mono text-[length:var(--text-2xs)] text-muted-foreground tabular-nums">
              {option.count}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
    <WorkflowStatusFilter
      value={value}
      openCount={openCount}
      doneCount={doneCount}
      ariaLabel="Filter manufacturing orders by status"
      onValueChange={onStatusChange}
    />
  );
}
