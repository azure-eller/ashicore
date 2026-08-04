"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GridApi, ICellRendererParams } from "ag-grid-community";
import { Add01Icon, Delete02Icon, MoreVerticalIcon } from "@hugeicons/core-free-icons";
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
import { DateTimeText } from "@/components/date-time-text";
import { fulfillmentStatusBlockTone } from "@/components/fulfillment-status-block";
import { StatusDetailMenuTable } from "@/components/status-detail-menu-table";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
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
import { compareDocumentNumbers } from "@/lib/document-number-format";
import { openGeneratedPdf } from "@/lib/client/generated-pdf";
import {
  getIngredientsDisplayState,
  getProductionDisplayState,
  type FulfillmentDisplayState,
  type SalesIngredientsFulfillmentState,
  type SalesProductionFulfillmentState,
} from "@/lib/sales/fulfillment-status";
import {
  MANUFACTURING_SALES_ORDER_TOOLTIP,
} from "@/lib/tooltip-copy";
import type { ManufacturingOrdersPreference } from "@/lib/view-preferences";
import { OrderStatusControl } from "@/components/card-page/order-status-control";
import { manufacturingOrderStatusConfig } from "@/components/card-page/order-status-configs";
import type { ManufacturingOrderListRow } from "@/lib/manufacturing/types";
import { queryKeys } from "@/lib/client/query-keys";
import {
  useGridSearchParam,
  useWorkflowTabForUrlQuery,
} from "@/lib/hooks/use-grid-search-param";

const OPEN_MANUFACTURING_STATUSES = ["open"] as const;
const DONE_MANUFACTURING_STATUSES = ["done"] as const;
const MANUFACTURING_ORDERS_VIEW_KEY = "manufacturing.orders";
const DEFAULT_MANUFACTURING_ORDERS_PREFERENCE: ManufacturingOrdersPreference = {
  version: 1,
};
type ManufacturingWorkflowFilterValue = WorkflowStatusFilterValue;
const ALL_RESOURCES_FILTER = "__all";
const NO_RESOURCE_FILTER = "__none";
const REMOVED_MANUFACTURING_ORDER_COLUMN_IDS = new Set([
  "plannedQuantity",
  "actualQuantity",
]);

function keepManufacturingRankVisible(
  grid: ERPGridPersistentState | undefined
): ERPGridPersistentState | undefined {
  if (!grid) return undefined;

  const columnOrder = grid.columnOrder as
    | { orderedColIds?: string[] }
    | undefined;
  const orderedColIds = columnOrder?.orderedColIds;
  const hasStaleColumnOrder =
    orderedColIds?.some((colId) =>
      REMOVED_MANUFACTURING_ORDER_COLUMN_IDS.has(colId)
    ) || (orderedColIds != null && !orderedColIds.includes("productionProgress"));
  const hiddenColIds = grid.columnVisibility?.hiddenColIds;
  if (!hasStaleColumnOrder && !hiddenColIds?.includes("priorityRank")) {
    return grid;
  }

  return {
    ...grid,
    ...(hasStaleColumnOrder ? { columnOrder: undefined } : {}),
    columnVisibility: {
      ...grid.columnVisibility,
      hiddenColIds: (hiddenColIds ?? []).filter((colId) => colId !== "priorityRank"),
    },
  };
}

function ProductCell({ order }: { order: ManufacturingOrderListRow }) {
  const productName =
    order.productAttrs.length > 0
      ? `${order.productMasterName} / ${order.productAttrs.join(" / ")}`
      : order.productMasterName;

  return (
    <div className="flex min-w-0 items-center">
      <span className="truncate" title={productName}>
        {productName}
      </span>
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

  return (
    <OrderStatusControl
      config={manufacturingOrderStatusConfig}
      ctx={{ order }}
      actionVariant="button"
      actionBoundary={{ flushPolicy: "none", requiresPersistedId: true }}
      onChanged={() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.manufacturingOrders.root });
        void queryClient.invalidateQueries({ queryKey: queryKeys.items.root });
      }}
    />
  );
}

function ProductionProgressCell({ order }: { order: ManufacturingOrderListRow }) {
  return (
    <span className="font-mono text-[length:var(--text-sm)] font-semibold tabular-nums text-[var(--color-ink)]">
      {formatQuantity(order.actualQuantity ?? "0")}/{formatQuantity(order.plannedQuantity)}
    </span>
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

  return compareDocumentNumbers(left.orderNumber, right.orderNumber, "MO");
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
  order,
}: {
  order: ManufacturingOrderListRow;
}) {
  if (!(OPEN_MANUFACTURING_STATUSES as readonly string[]).includes(order.status)) {
    return <span className="text-[var(--color-ink-faint)]">-</span>;
  }

  return (
    <div className="flex h-full items-center">
      <span className="w-(--space-16) text-[var(--color-ink-faint)] tabular-nums">
        {order.priorityRank ?? "-"}
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
  const [searchValue, setSearchValue, urlQuery] = useGridSearchParam();
  const [selectedOrders, setSelectedOrders] = useState<ManufacturingOrderListRow[]>([]);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [hasActiveSort, setHasActiveSort] = useState(false);
  const [ordersPreference, setOrdersPreference] = usePersistentViewState({
    viewKey: MANUFACTURING_ORDERS_VIEW_KEY,
    defaultValue: DEFAULT_MANUFACTURING_ORDERS_PREFERENCE,
  });
  const { data: orders = initialData } = useQuery({
    queryKey: queryKeys.manufacturingOrders.root,
    queryFn: () =>
      apiJson<ManufacturingOrderListRow[]>("/api/manufacturing-orders", {
        fallbackError: "Failed to fetch manufacturing orders.",
      }),
    initialData,
  });
  const searchedOrders = useMemo(
    () => orders.filter((order) => manufacturingOrderMatchesSearch(order, searchValue)),
    [orders, searchValue]
  );
  // Counts reflect the active search ("matches per tab"), so a search whose
  // hits live on the other tab is never silently invisible.
  const openCount = searchedOrders.filter((order) =>
    (OPEN_MANUFACTURING_STATUSES as readonly string[]).includes(order.status)
  ).length;
  const doneCount = searchedOrders.filter((order) =>
    (DONE_MANUFACTURING_STATUSES as readonly string[]).includes(order.status)
  ).length;
  useWorkflowTabForUrlQuery({
    urlQuery,
    searchValue,
    ready: orders.length > 0,
    openMatches: openCount,
    doneMatches: doneCount,
    tab: statusFilter,
    onTabChange: setStatusFilter,
  });
  const statusFilteredOrders = useMemo(() => {
    const allowedStatuses =
      statusFilter === "done"
        ? DONE_MANUFACTURING_STATUSES
        : OPEN_MANUFACTURING_STATUSES;
    return searchedOrders.filter((order) =>
      (allowedStatuses as readonly string[]).includes(order.status)
    );
  }, [searchedOrders, statusFilter]);
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
  const gridColumns = useMemo<ColDef<ManufacturingOrderListRow>[]>(
    () => [
      {
        colId: "priorityRank",
        field: "priorityRank",
        headerName: "Rank",
        width: 60,
        minWidth: 52,
        maxWidth: 90,
        resizable: false,
        sortable: false,
        rowDrag: reorderAvailable,
        hide: statusFilter !== "open",
        cellRenderer: ({ data }: ICellRendererParams<ManufacturingOrderListRow>) =>
          data ? (
            <RankCell order={data} />
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
          compareDocumentNumbers(String(left ?? ""), String(right ?? ""), "MO"),
      },
      {
        field: "productName",
        headerName: "Product",
        width: 320,
        minWidth: 240,
        flex: 1.3,
        cellClass: "emphasis",
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
        colId: "productionProgress",
        headerName: "Progress",
        width: 170,
        minWidth: 150,
        cellClass: "num",
        valueGetter: ({ data }) =>
          data ? `${data.actualQuantity ?? "0"} / ${data.plannedQuantity}` : "",
        comparator: (_left, _right, leftNode, rightNode) => {
          const leftPlanned = Number(leftNode.data?.plannedQuantity ?? "0");
          const rightPlanned = Number(rightNode.data?.plannedQuantity ?? "0");
          const leftActual = Number(leftNode.data?.actualQuantity ?? "0");
          const rightActual = Number(rightNode.data?.actualQuantity ?? "0");
          const leftRatio =
            Number.isFinite(leftPlanned) && leftPlanned > 0 ? leftActual / leftPlanned : 0;
          const rightRatio =
            Number.isFinite(rightPlanned) && rightPlanned > 0 ? rightActual / rightPlanned : 0;

          return leftRatio - rightRatio;
        },
        cellRenderer: ({ data }: ICellRendererParams<ManufacturingOrderListRow>) =>
          data ? <ProductionProgressCell order={data} /> : null,
      },
      {
        field: "completedAt",
        headerName: "Completed",
        width: 190,
        hide: statusFilter !== "done",
        cellRenderer: ({ data }: ICellRendererParams<ManufacturingOrderListRow>) =>
          data ? <DateTimeText value={data.completedAt} /> : null,
      },
      {
        field: "plannedDate",
        headerName: "Production deadline",
        width: 150,
        valueFormatter: ({ value }) => formatDate(value as string | null),
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
      await queryClient.cancelQueries({ queryKey: queryKeys.manufacturingOrders.root });
      const previous =
        queryClient.getQueryData<ManufacturingOrderListRow[]>([
          "manufacturing-orders",
        ]);
      const rankById = new Map(
        orderedRows.map((row, index) => [row.id, index + 1])
      );

      queryClient.setQueryData<ManufacturingOrderListRow[]>(
        queryKeys.manufacturingOrders.root,
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
      queryClient.setQueryData(queryKeys.manufacturingOrders.root, context?.previous);
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
        queryClient.invalidateQueries({ queryKey: queryKeys.manufacturingOrders.root }),
        queryClient.invalidateQueries({ queryKey: queryKeys.items.root }),
      ]);
      setSelectedOrders([]);
      setDeleteDialogOpen(false);
    },
  });
  const selectedCount = selectedOrders.length;
  const generateSelectedPdf = (disposition: "inline" | "attachment") => {
    setPdfError(null);
    void openGeneratedPdf(
      "/api/manufacturing-orders/pdf",
      { ids: selectedOrders.map((order) => order.id), template: "manufacturing-order" },
      disposition,
    ).catch((error) => setPdfError(error instanceof Error ? error.message : "Failed to generate PDF."));
  };

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
          <>
            <WorkflowStatusFilter
              value={statusFilter}
              openCount={openCount}
              doneCount={doneCount}
              ariaLabel="Filter manufacturing orders by status"
              onValueChange={setStatusFilter}
            />
            {pdfError ? <p role="alert" className="text-sm text-destructive">{pdfError}</p> : null}
          </>
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="icon" disabled={selectedCount === 0} aria-label={`Document actions (${selectedCount} selected)`} className="relative">
                  <HugeiconsIcon icon={MoreVerticalIcon} className="h-4 w-4" aria-hidden />
                  <SelectionCountBadge count={selectedCount} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => generateSelectedPdf("inline")}>Print selected manufacturing orders</DropdownMenuItem>
                <DropdownMenuItem onClick={() => generateSelectedPdf("attachment")}>Download selected manufacturing orders PDF</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button asChild aria-label="New Order">
              <Link href="/manufacturing/order">
                <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
                New Order
              </Link>
            </Button>
          </>
        }
        className="flex h-[calc(100dvh_-_var(--height-nav)_-_var(--height-subnav))] min-h-0 flex-col gap-(--space-7) bg-[var(--color-bg)]"
        gridClassName="min-h-0 flex-1"
        height="100%"
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
              Picked inventory and open demand will be released. Batch orders with
              completed batches keep completed output and consumed ingredients
              as production history while remaining work is cancelled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
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
        className="max-w-[220px] bg-[var(--color-bg)]"
      >
        <SelectValue placeholder="All resources" />
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value={ALL_RESOURCES_FILTER}>
          All resources
          <span className="font-mono text-[length:var(--text-2xs)] text-[var(--color-ink-faint)] tabular-nums">
            {orderCount}
          </span>
        </SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
            <span className="font-mono text-[length:var(--text-2xs)] text-[var(--color-ink-faint)] tabular-nums">
              {option.count}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
