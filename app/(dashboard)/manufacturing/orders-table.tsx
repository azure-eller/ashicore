"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ICellRendererParams } from "ag-grid-community";
import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { apiJson } from "@/lib/client/api";
import { usePersistentViewState } from "@/lib/client/use-persistent-view-state";
import {
  ERPDataGrid,
  type ColDef,
  type ERPGridPersistentState,
} from "@/components/erp-data-grid";
import { QuantityWithUnit } from "@/components/quantity-with-unit";
import { DateTimeText } from "@/components/date-time-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBlock, type StatusBlockTone } from "@/components/ui/status-block";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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

const BADGE_VARIANTS = ["secondary", "outline", "default"] as const;
const OPEN_MANUFACTURING_STATUSES = ["open"] as const;
const DONE_MANUFACTURING_STATUSES = ["done"] as const;
const MANUFACTURING_ORDERS_VIEW_KEY = "manufacturing.orders";
const DEFAULT_MANUFACTURING_ORDERS_PREFERENCE: ManufacturingOrdersPreference = {
  version: 1,
};
type ManufacturingWorkflowFilterValue = "open" | "done";
const ALL_RESOURCES_FILTER = "__all";
const NO_RESOURCE_FILTER = "__none";

function keepManufacturingRankDraggable(
  grid: ERPGridPersistentState | undefined
): ERPGridPersistentState | undefined {
  if (!grid) return undefined;

  return {
    ...grid,
    sort: undefined,
    columnVisibility: {
      ...grid.columnVisibility,
      hiddenColIds:
        grid.columnVisibility?.hiddenColIds?.filter(
          (colId) => colId !== "priorityRank"
        ) ?? [],
    },
  };
}

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

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getOrderProgress(order: ManufacturingOrderListRow) {
  if (order.status === "done") {
    return { percent: 100, label: "Complete" };
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
          : "Progress",
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
        : "Progress",
  };
}

function ProductionProgressBar({ order }: { order: ManufacturingOrderListRow }) {
  const progress = getOrderProgress(order);
  const batchCount =
    order.manufacturingMode === "batch" ? order.numberOfBatches ?? 0 : 0;

  return (
    <div className="flex min-w-0 flex-col gap-(--space-1)">
      <div className="flex items-center justify-between gap-(--space-3) text-[length:var(--text-xs)] leading-none">
        <span className="truncate text-muted-foreground">{progress.label}</span>
        <span className="font-mono tabular-nums">{progress.percent}%</span>
      </div>
      {batchCount > 1 ? (
        <div
          className="grid h-(--space-3) gap-px"
          style={{
            gridTemplateColumns: `repeat(${batchCount}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: batchCount }, (_, index) => (
            <span
              key={index}
              className={
                index < order.completedBatchCount
                  ? "bg-[var(--color-ink)]"
                  : "bg-border"
              }
              aria-hidden="true"
            />
          ))}
        </div>
      ) : (
        <div className="h-(--space-2) bg-border">
          <div
            className="h-full bg-[var(--color-ink)] transition-[width]"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      )}
    </div>
  );
}

function getIngredientState(order: ManufacturingOrderListRow): FulfillmentDisplayState {
  const ingredientState: SalesIngredientsFulfillmentState =
    order.ingredientReadiness === "picking"
      ? "in_stock"
      : order.ingredientReadiness;
  return getIngredientsDisplayState(ingredientState);
}

function getProductionState(order: ManufacturingOrderListRow): FulfillmentDisplayState {
  let productionState: SalesProductionFulfillmentState = "not_started";

  if (order.status === "done") {
    productionState = "done";
  } else if (
    order.startedAt != null ||
    order.pickProgressStatus === "in_progress" ||
    order.pickProgressStatus === "picked" ||
    order.completedBatchCount > 0
  ) {
    productionState = "in_progress";
  }

  return getProductionDisplayState(productionState);
}

const fulfillmentToneToStatusBlockTone: Record<
  FulfillmentDisplayState["tone"],
  StatusBlockTone
> = {
  destructive: "danger",
  muted: "muted",
  secondary: "warning",
  success: "success",
  warning: "warning",
};

function IngredientsStatusCell({ order }: { order: ManufacturingOrderListRow }) {
  const state = getIngredientState(order);
  const rows = order.ingredientShortages;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <StatusBlock
          tone={fulfillmentToneToStatusBlockTone[state.tone]}
          actionable
          actionVariant="button"
          onClick={(event) => event.stopPropagation()}
          aria-label={`Ingredients: ${state.label}`}
        >
          {state.label}
        </StatusBlock>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[420px]">
        <DropdownMenuLabel>Short ingredients</DropdownMenuLabel>
        {rows.length === 0 ? (
          <div className="px-(--space-3) py-(--space-4) text-[length:var(--text-sm)] text-muted-foreground">
            No ingredient shortages.
          </div>
        ) : (
          <div className="max-h-[320px] overflow-y-auto">
            <div className="grid grid-cols-[minmax(0,1fr)_64px_64px] gap-x-(--space-5) border-b border-border px-(--space-3) py-(--space-2) text-[length:var(--text-xs)] font-medium text-muted-foreground">
              <div>Item</div>
              <div className="text-right">Needed</div>
              <div className="text-right">Available</div>
            </div>
            {rows.map((row) => (
              <div
                key={row.itemId}
                className="grid grid-cols-[minmax(0,1fr)_64px_64px] items-start gap-x-(--space-5) border-b border-border/60 px-(--space-3) py-(--space-3) text-[length:var(--text-sm)] last:border-b-0"
              >
                <div className="min-w-0 truncate font-medium">{row.itemName}</div>
                <div className="text-right font-mono text-[length:var(--text-xs)] tabular-nums text-muted-foreground">
                  {formatQuantity(row.needed)}
                </div>
                <div className="text-right font-mono text-[length:var(--text-xs)] tabular-nums text-muted-foreground">
                  {formatQuantity(row.available)}
                </div>
              </div>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProductionActionCell({ order }: { order: ManufacturingOrderListRow }) {
  const queryClient = useQueryClient();
  return (
    <div className="flex h-full min-w-0 flex-col justify-center gap-(--space-2) py-(--space-2)">
      <OrderStatusControl
        config={manufacturingOrderStatusConfig}
        ctx={{ order }}
        disabled={isManufacturingStatusDisabled(order)}
        onChanged={() => {
          void queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
          void queryClient.invalidateQueries({ queryKey: ["items"] });
        }}
      />
      <ProductionProgressBar order={order} />
    </div>
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
  const [statusFilter, setStatusFilter] =
    useState<ManufacturingWorkflowFilterValue>("open");
  const [resourceFilter, setResourceFilter] = useState(ALL_RESOURCES_FILTER);
  const [searchValue, setSearchValue] = useState("");
  const [selectedOrders, setSelectedOrders] = useState<ManufacturingOrderListRow[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
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
  const reorderEnabled = statusFilter === "open";
  const persistedGridState = useMemo(
    () => keepManufacturingRankDraggable(ordersPreference.grid),
    [ordersPreference.grid]
  );
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
        cellClass: "productionProgressCell",
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
        enableManagedRowDrag={reorderEnabled}
        suppressMoveWhenRowDragging
        resetRowDataOnUpdate
        persistedGridState={persistedGridState}
        onPersistedGridStateChange={(grid) => {
          setOrdersPreference((current) => ({
            ...current,
            grid: keepManufacturingRankDraggable(grid),
          }));
        }}
        onManagedRowDragReorder={(orderedRows) => {
          if (!reorderEnabled || reorderMutation.isPending) {
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
              {selectedCount > 0 ? (
                <span
                  aria-hidden
                  className="absolute -top-(--space-2) -right-(--space-2) flex h-(--space-8) min-w-(--space-8) items-center justify-center bg-primary px-(--space-1) font-mono text-[length:var(--text-2xs)] font-medium tabular-nums text-primary-foreground"
                >
                  {selectedCount}
                </span>
              ) : null}
            </Button>
            <Button asChild aria-label="New Order">
              <Link href="/manufacturing/order">
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
    <ToggleGroup
      type="single"
      variant="segmented"
      size="sm"
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue === "open" || nextValue === "done") {
          onStatusChange(nextValue);
        }
      }}
      aria-label="Filter manufacturing orders by status"
      className="max-w-full flex-wrap bg-muted p-(--space-1)"
    >
      <ToggleGroupItem
        value="open"
        aria-label="Show open orders"
        className="gap-(--space-3)"
        onClick={() => onStatusChange("open")}
      >
        Open
        <span className="font-mono text-[length:var(--text-2xs)] tabular-nums text-muted-foreground">
          {openCount}
        </span>
      </ToggleGroupItem>
      <ToggleGroupItem
        value="done"
        aria-label="Show done orders"
        className="gap-(--space-3)"
        onClick={() => onStatusChange("done")}
      >
        Done
        <span className="font-mono text-[length:var(--text-2xs)] tabular-nums text-muted-foreground">
          {doneCount}
        </span>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
