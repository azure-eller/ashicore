"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { GridApi, ICellRendererParams } from "ag-grid-community";
import { apiJson } from "@/lib/client/api";
import { ERPDataGrid, type ColDef } from "@/components/erp-data-grid";
import { SelectionCountBadge } from "@/components/selection-count-badge";
import { WorkflowStatusFilter } from "@/components/workflow-status-filter";
import {
  Add01Icon,
  DatabaseExportIcon,
  Delete02Icon,
  Sorting05Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ORDER_TOTAL_TOOLTIP,
  SALES_ORDER_CUSTOMER_TOOLTIP,
  SALES_ORDER_DELIVERY_STATUS_TOOLTIP,
  SALES_ORDER_INGREDIENTS_STATUS_TOOLTIP,
  SALES_ORDER_ITEMS_STATUS_TOOLTIP,
  SALES_ORDER_NOTES_TOOLTIP,
  SALES_ORDER_NUMBER_TOOLTIP,
  SALES_ORDER_PRODUCTION_STATUS_TOOLTIP,
  SALES_ORDER_RANK_TOOLTIP,
  SALES_ORDER_SHIP_DATE_TOOLTIP,
} from "@/lib/tooltip-copy";
import { formatDate, formatPrice, formatQuantity, parseQuantity } from "@/lib/format";
import { displaySalesOrderNotes } from "@/lib/sales/import-notes";
import {
  getSalesItemsAvailabilityState,
  getSalesItemsState,
} from "@/lib/sales/order-display-status";
import {
  getIngredientsDisplayState,
  getProductionDisplayState,
  type FulfillmentDisplayState,
} from "@/lib/sales/fulfillment-status";
import {
  ProductionActionCell,
  StatusDetailCell,
  ingredientsStatusEmptyMessage,
} from "./sales-order-table-action-cells";
import { OrderStatusControl } from "@/components/card-page/order-status-control";
import {
  isSalesOrderStatusDisabled,
  salesOrderStatusConfig,
} from "@/components/card-page/order-status-configs";
import type { SalesOrderListRow } from "./types";

function SalesDeliveryCell({ order }: { order: SalesOrderListRow }) {
  const queryClient = useQueryClient();
  return (
    <OrderStatusControl
      config={salesOrderStatusConfig}
      ctx={{ order }}
      disabled={isSalesOrderStatusDisabled(order)}
      onChanged={() => {
        void queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
        void queryClient.invalidateQueries({ queryKey: ["items"] });
      }}
    />
  );
}

const OPEN_SALES_STATUSES = ["open"] as const;
const DONE_SALES_STATUSES = ["done"] as const;
type SalesWorkflowFilterValue = "open" | "done";

const SALES_ORDER_AUTO_SIZE_COLUMN_IDS = [
  "orderNumber",
  "allocation",
  "ingredientsState",
  "productionState",
  "deliveryState",
  "shipDate",
] as const;

function autoSizeSalesOrderStatusColumns(api: GridApi<SalesOrderListRow>) {
  window.requestAnimationFrame(() => {
    api.autoSizeColumns([...SALES_ORDER_AUTO_SIZE_COLUMN_IDS], true);
  });
}

function isOpenSalesOrder(order: SalesOrderListRow) {
  return (OPEN_SALES_STATUSES as readonly string[]).includes(order.status);
}

function NotesCell({ notes }: { notes: string | null }) {
  const trimmedNotes = displaySalesOrderNotes(notes);

  if (!trimmedNotes) {
    return <span className="text-[var(--color-ink-faint)]">—</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="block w-full overflow-hidden text-ellipsis text-left text-[var(--color-ink-faint)] outline-none hover:text-[var(--color-ink)] focus-visible:text-[var(--color-ink)]"
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

function shippedSalesQuantity(order: SalesOrderListRow) {
  return order.lines.reduce(
    (sum, line) => sum + parseQuantity(line.shippedQuantity),
    0
  );
}

function getOrderShipmentSchedule(order: SalesOrderListRow) {
  const date = order.shipDate ?? null;

  return {
    date,
    label: date ? formatDate(date) : "—",
  };
}

function formatOrderLineItemName(line: SalesOrderListRow["lines"][number]) {
  return line.attrs.length > 0
    ? `${line.masterName} / ${line.attrs.join(" / ")}`
    : line.masterName;
}

function SalesItemsActionCell({
  order,
}: {
  order: SalesOrderListRow;
}) {
  const hasLines = order.lines.length > 0;
  const state =
    !hasLines
      ? ({ label: "Not applicable", tone: "muted" } satisfies FulfillmentDisplayState)
      : getSalesItemsAvailabilityState(order);
  const rows = order.lines.map((line) => ({
    id: line.id ?? line.itemId,
    item: formatOrderLineItemName(line),
    needed: formatQuantity(line.remainingQty ?? line.quantity),
    available: formatQuantity(line.demandQueueInStockQty ?? "0"),
    expected: formatQuantity(line.demandQueueExpectedQty ?? "0"),
  }));

  return (
    <StatusDetailCell
      label="Sales items"
      menuLabel="Sales items"
      state={state}
      rows={rows}
      emptyMessage="No sales items."
      interactive={hasLines}
    />
  );
}

function getProductionState(order: SalesOrderListRow): FulfillmentDisplayState {
  return getProductionDisplayState(order.fulfillmentSummary.productionState);
}

function getIngredientsState(order: SalesOrderListRow): FulfillmentDisplayState {
  return getIngredientsDisplayState(
    order.fulfillmentSummary.ingredientsState,
    order.fulfillmentSummary.ingredientsExpectedDate
  );
}

function IngredientsStatusCell({ order }: { order: SalesOrderListRow }) {
  const state = getIngredientsState(order);
  const rows = order.fulfillmentSummary.ingredientShortages.map((shortage) => ({
    id: shortage.itemId,
    item: shortage.itemName,
    needed: formatQuantity(shortage.requiredQty),
    available: formatQuantity(shortage.availableQty),
    expected: formatQuantity(shortage.expectedQty),
    short: shortage.availabilityStatus === "missing",
  }));

  return (
    <StatusDetailCell
      label="Ingredients"
      menuLabel="Short ingredients"
      state={state}
      emptyMessage={ingredientsStatusEmptyMessage(state, "order")}
      rows={rows}
    />
  );
}

function getDeliveryState(order: SalesOrderListRow): FulfillmentDisplayState {
  if (order.status === "done") {
    return { label: "Shipped", tone: "success" };
  }

  if (shippedSalesQuantity(order) > 0) {
    return { label: "Partially shipped", tone: "warning" };
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

function salesOrderMatchesSearch(
  order: SalesOrderListRow,
  searchValue: string
) {
  const normalizedSearch = searchValue.trim().toLowerCase();

  if (!normalizedSearch) {
    return true;
  }

  return [
    order.orderNumber,
    order.customerName,
    order.notes,
    order.totalAmount,
    getOrderShipmentSchedule(order).date,
    getOrderShipmentSchedule(order).label,
    order.lines.length === 0
      ? "Not applicable"
      : getSalesItemsState(order).label,
    getIngredientsState(order).label,
    getProductionState(order).label,
    getDeliveryState(order).label,
  ].some((value) => value?.toLowerCase().includes(normalizedSearch));
}

function RankCell({ order }: { order: SalesOrderListRow }) {
  if (!isOpenSalesOrder(order)) {
    return <span className="text-[var(--color-ink-faint)]">-</span>;
  }

  return (
    <div className="flex h-full min-w-0 items-center">
      <span className="w-(--space-16) text-[var(--color-ink-faint)] tabular-nums">
        {order.priorityRank ?? "-"}
      </span>
    </div>
  );
}

function LastSyncStatus({ dataUpdatedAt }: { dataUpdatedAt: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const seconds = Math.max(0, Math.floor((now - dataUpdatedAt) / 1000));

  return <span>Last sync {seconds < 30 ? "<30" : seconds}s ago</span>;
}

const SALES_ORDER_SORT_LABELS: Record<string, string> = {
  orderNumber: "Order",
  customerName: "Customer",
  notes: "Notes",
  totalAmount: "Total",
  allocation: "Sales items",
  ingredientsState: "Ingredients",
  productionState: "Production",
  deliveryState: "Delivery",
  shipDate: "Delivery deadline",
};

function getSalesOrderSortSummary(api: GridApi<SalesOrderListRow>) {
  const sortedColumns = api
    .getColumnState()
    .filter((column) => column.sort)
    .sort((left, right) => (left.sortIndex ?? 0) - (right.sortIndex ?? 0));

  if (sortedColumns.length === 0) return null;

  const [primary] = sortedColumns;
  const label = SALES_ORDER_SORT_LABELS[primary.colId] ?? primary.colId;
  const direction = primary.sort === "desc" ? "↓" : "↑";
  const extraCount = sortedColumns.length - 1;

  return extraCount > 0
    ? `${label} ${direction} +${extraCount}`
    : `${label} ${direction}`;
}

export function OrdersTable({
  initialData,
}: {
  initialData: SalesOrderListRow[];
}) {
  return <OrdersTableContent initialData={initialData} />;
}

function OrdersTableContent({
  initialData,
}: {
  initialData: SalesOrderListRow[];
}) {
  const queryClient = useQueryClient();
  const gridApiRef = useRef<GridApi<SalesOrderListRow> | null>(null);
  const hasAutoSizedColumnsRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [statusFilter, setStatusFilter] =
    useState<SalesWorkflowFilterValue>("open");
  const [searchValue, setSearchValue] = useState("");
  const [selectedOrders, setSelectedOrders] = useState<SalesOrderListRow[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [hasActiveSort, setHasActiveSort] = useState(false);
  const [sortSummary, setSortSummary] = useState<string | null>(null);
  const { data: orders = initialData, dataUpdatedAt } = useQuery({
    queryKey: ["sales-orders"],
    queryFn: () =>
      apiJson<SalesOrderListRow[]>("/api/sales-orders", {
        fallbackError: "Failed to fetch orders.",
      }),
    initialData,
  });
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inField = target?.closest(
        "input, textarea, select, [contenteditable='true']"
      );

      if (
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !inField
      ) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }

      if (
        event.key.toLowerCase() === "n" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !inField
      ) {
        window.location.href = "/sales/order";
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();

    for (const order of orders) {
      counts.set(order.status, (counts.get(order.status) ?? 0) + 1);
    }

    return counts;
  }, [orders]);
  const openOrders = useMemo(
    () => orders.filter((order) => isOpenSalesOrder(order)),
    [orders]
  );
  const openCount = openOrders.length;
  const doneCount = DONE_SALES_STATUSES.reduce(
    (sum, status) => sum + (statusCounts.get(status) ?? 0),
    0
  );
  const displayedOrders = useMemo(() => {
    const allowedStatuses =
      statusFilter === "done" ? DONE_SALES_STATUSES : OPEN_SALES_STATUSES;
    const filteredOrders = orders.filter(
      (order) =>
        (allowedStatuses as readonly string[]).includes(order.status) &&
        salesOrderMatchesSearch(order, searchValue)
    );

    if (statusFilter === "done") {
      return filteredOrders;
    }

    return [...filteredOrders].sort(compareSalesOrderRank);
  }, [orders, searchValue, statusFilter]);
  useEffect(() => {
    if (
      !hasAutoSizedColumnsRef.current &&
      displayedOrders.length > 0 &&
      gridApiRef.current
    ) {
      hasAutoSizedColumnsRef.current = true;
      autoSizeSalesOrderStatusColumns(gridApiRef.current);
    }
  }, [displayedOrders.length]);
  const hasSearchFilter = searchValue.trim().length > 0;
  const reorderEnabled =
    statusFilter === "open" && !hasSearchFilter && !hasActiveSort;
  const hasActiveFilter = statusFilter !== "open" || hasSearchFilter;
  const filterSummary =
    statusFilter === "done"
      ? "Done"
      : hasSearchFilter
        ? "Search"
        : "Open";
  const defaultSortSummary = statusFilter === "open" ? "Rank" : "None";
  const displayedSortSummary = hasActiveSort
    ? sortSummary ?? "Sorted"
    : defaultSortSummary;
  const gridColumns = useMemo<ColDef<SalesOrderListRow>[]>(
    () => [
      {
        colId: "priorityRank",
        field: "priorityRank",
        headerName: "Rank",
        headerTooltip: SALES_ORDER_RANK_TOOLTIP,
        width: 64,
        minWidth: 56,
        maxWidth: 110,
        resizable: false,
        sortable: false,
        rowDrag: reorderEnabled,
        rowDragText: ({ defaultTextValue }) => `Move ${defaultTextValue}`,
        hide: statusFilter !== "open",
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderListRow>) =>
          data ? (
            <RankCell order={data} />
          ) : null,
        getQuickFilterText: () => "",
      },
      {
        field: "orderNumber",
        headerName: "Order",
        headerTooltip: SALES_ORDER_NUMBER_TOOLTIP,
        width: 150,
        minWidth: 140,
        maxWidth: 190,
        cellClass: "mono",
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderListRow>) =>
          data ? (
            <Link
              href={`/sales/order/${data.id}`}
              className="block truncate hover:underline"
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
        field: "customerName",
        headerName: "Customer",
        headerTooltip: SALES_ORDER_CUSTOMER_TOOLTIP,
        width: 260,
        minWidth: 170,
        maxWidth: 320,
        flex: 1,
        cellClass: "emphasis",
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderListRow>) =>
          data ? (
            <span className="block truncate">{data.customerName}</span>
          ) : null,
      },
      {
        field: "notes",
        headerName: "Notes",
        headerTooltip: SALES_ORDER_NOTES_TOOLTIP,
        width: 190,
        minWidth: 150,
        maxWidth: 300,
        flex: 1,
        cellClass: "muted",
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderListRow>) =>
          data ? <NotesCell notes={data.notes} /> : null,
        getQuickFilterText: ({ data }) => displaySalesOrderNotes(data?.notes) ?? "",
      },
      {
        field: "totalAmount",
        headerName: "Total",
        headerTooltip: ORDER_TOTAL_TOOLTIP,
        width: 110,
        minWidth: 110,
        cellClass: "num num-end",
        comparator: (left, right) =>
          parseFloat(String(left ?? "0")) - parseFloat(String(right ?? "0")),
        valueFormatter: ({ value }) => formatPrice(String(value ?? "")) ?? "—",
      },
      {
        colId: "allocation",
        headerName: "Sales Items",
        headerTooltip: SALES_ORDER_ITEMS_STATUS_TOOLTIP,
        width: 160,
        minWidth: 150,
        cellClass: "statusBlockCell",
        valueGetter: ({ data }) =>
          data
            ? data.lines.length === 0
              ? "Not applicable"
              : getSalesItemsAvailabilityState(data).label
            : "",
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderListRow>) =>
          data ? (
            <SalesItemsActionCell order={data} />
          ) : null,
        comparator: (_left, _right, leftNode, rightNode) =>
          parseQuantity(leftNode.data?.fulfillmentSummary.shortQty) -
          parseQuantity(rightNode.data?.fulfillmentSummary.shortQty),
      },
      {
        colId: "ingredientsState",
        headerName: "Ingredients",
        headerTooltip: SALES_ORDER_INGREDIENTS_STATUS_TOOLTIP,
        width: 172,
        minWidth: 160,
        cellClass: "statusBlockCell",
        valueGetter: ({ data }) => (data ? getIngredientsState(data).label : ""),
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderListRow>) =>
          data ? <IngredientsStatusCell order={data} /> : null,
      },
      {
        colId: "productionState",
        headerName: "Production",
        headerTooltip: SALES_ORDER_PRODUCTION_STATUS_TOOLTIP,
        width: 140,
        minWidth: 130,
        cellClass: "statusBlockCell",
        valueGetter: ({ data }) => (data ? getProductionState(data).label : ""),
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderListRow>) =>
          data ? (
            <ProductionActionCell
              order={data}
              state={getProductionState(data)}
            />
          ) : null,
        comparator: (_left, _right, leftNode, rightNode) =>
          (leftNode.data?.openManufacturingOrderCount ?? 0) -
          (rightNode.data?.openManufacturingOrderCount ?? 0),
      },
      {
        colId: "deliveryState",
        headerName: "Delivery",
        headerTooltip: SALES_ORDER_DELIVERY_STATUS_TOOLTIP,
        width: 140,
        minWidth: 130,
        cellClass: "statusBlockCell",
        valueGetter: ({ data }) => (data ? getDeliveryState(data).label : ""),
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderListRow>) =>
          data ? <SalesDeliveryCell order={data} /> : null,
        comparator: (_left, _right, leftNode, rightNode) => {
          const leftOrder = leftNode.data;
          const rightOrder = rightNode.data;

          if (!leftOrder || !rightOrder) return 0;

          const doneRank =
            doneSalesOrderRank(leftOrder) - doneSalesOrderRank(rightOrder);
          if (doneRank !== 0) return doneRank;

          return (getOrderShipmentSchedule(leftOrder).date ?? "").localeCompare(
            getOrderShipmentSchedule(rightOrder).date ?? ""
          );
        },
      },
      {
        colId: "shipDate",
        headerName: "Delivery deadline",
        headerTooltip: SALES_ORDER_SHIP_DATE_TOOLTIP,
        width: 116,
        minWidth: 110,
        cellClass: "mono",
        valueGetter: ({ data }) => (data ? getOrderShipmentSchedule(data).date : null),
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderListRow>) =>
          data ? getOrderShipmentSchedule(data).label : "—",
        comparator: (_left, _right, leftNode, rightNode) => {
          const dateCompare = String(
            leftNode.data ? getOrderShipmentSchedule(leftNode.data).date : ""
          ).localeCompare(
            String(rightNode.data ? getOrderShipmentSchedule(rightNode.data).date : "")
          );

          if (dateCompare !== 0) {
            return dateCompare;
          }

          return (leftNode.data?.orderNumber ?? "").localeCompare(
            rightNode.data?.orderNumber ?? "",
            undefined,
            { numeric: true }
          );
        },
      },
    ],
    [reorderEnabled, statusFilter]
  );
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
        (current) => {
          if (!current) return current;

          const currentById = new Map(current.map((row) => [row.id, row]));
          const orderedIds = new Set(orderedRows.map((row) => row.id));
          const reorderedRows = orderedRows.map((row) => ({
            ...(currentById.get(row.id) ?? row),
            priorityRank: rankById.get(row.id) ?? row.priorityRank,
          }));
          const untouchedRows = current
            .filter((row) => !orderedIds.has(row.id))
            .map((row) => ({
              ...row,
              priorityRank: rankById.get(row.id) ?? row.priorityRank,
            }));

          return [...reorderedRows, ...untouchedRows];
        }
      );

      return { previous };
    },
    onError: (_error, _orderedRows, context) => {
      queryClient.setQueryData(["sales-orders"], context?.previous);
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await apiJson<void>("/api/sales-orders", {
        method: "DELETE",
        body: { ids },
        idempotencyKey: "sales-orders-delete",
        fallbackError: "Failed to delete orders.",
      });
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      setSelectedOrders([]);
      setDeleteDialogOpen(false);
    },
  });
  const selectedCount = selectedOrders.length;
  const clearSort = () => {
    gridApiRef.current?.applyColumnState({
      defaultState: { sort: null },
    });
    setHasActiveSort(false);
    setSortSummary(null);
  };
  const clearFilter = () => {
    setStatusFilter("open");
    setSearchValue("");
    searchInputRef.current?.blur();
  };

  return (
    <>
      <ERPDataGrid
        rows={displayedOrders}
        columns={gridColumns}
        searchInputRef={searchInputRef}
        searchAriaLabel="Search orders, customers, PO"
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        emptyMessage="No sales orders yet."
        enableRowSelection
        hideHeaderSelectionCheckbox
        onSelectionChange={setSelectedOrders}
        enableManagedRowDrag={reorderEnabled}
        suppressMoveWhenRowDragging
        relaxResizableMaxWidth
        toolbarContent={
          <WorkflowStatusFilter
            value={statusFilter}
            openCount={openCount}
            doneCount={doneCount}
            ariaLabel="Filter sales orders by workflow"
            onValueChange={setStatusFilter}
          />
        }
        actions={
          <>
            {hasActiveSort ? (
              <>
                <div className="h-(--space-10) w-px bg-[var(--color-line-2)]" />
                <div className="flex items-center gap-(--space-2)">
                  <Button type="button" variant="secondary" size="sm" onClick={clearSort}>
                    <HugeiconsIcon icon={Sorting05Icon} data-icon="inline-start" />
                    Reset sort
                  </Button>
                </div>
              </>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-(--height-grid-action-control) whitespace-nowrap px-(--space-7) text-[length:var(--text-sm)]"
              onClick={() => gridApiRef.current?.exportDataAsCsv()}
            >
              <HugeiconsIcon icon={DatabaseExportIcon} data-icon="inline-start" />
              Export
            </Button>
            <Button
              type="button"
              variant="danger"
              size="icon"
              disabled={selectedCount === 0 || deleteMutation.isPending}
              className="relative size-(--height-grid-action-control) whitespace-nowrap"
              aria-label={
                selectedCount > 0
                  ? `Delete ${selectedCount} selected`
                  : "Delete selected"
              }
              onClick={() => {
                if (selectedCount === 0) return;
                setDeleteDialogOpen(true);
              }}
            >
              <HugeiconsIcon icon={Delete02Icon} aria-hidden />
              <SelectionCountBadge count={selectedCount} />
            </Button>
            <Button
              asChild
              aria-label="New Order"
              className="h-(--height-grid-action-control) whitespace-nowrap px-(--space-8) text-[length:var(--text-sm)]"
            >
              <Link href="/sales/order">
                <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
                New Order
              </Link>
            </Button>
          </>
        }
        onGridReady={(event) => {
          gridApiRef.current = event.api;
          if (displayedOrders.length > 0 && !hasAutoSizedColumnsRef.current) {
            hasAutoSizedColumnsRef.current = true;
            autoSizeSalesOrderStatusColumns(event.api);
          }
        }}
        onFirstDataRendered={(event) => {
          if (!hasAutoSizedColumnsRef.current) {
            hasAutoSizedColumnsRef.current = true;
            autoSizeSalesOrderStatusColumns(event.api);
          }
        }}
        onSortChange={(nextHasActiveSort) => {
          setHasActiveSort(nextHasActiveSort);
          const api = gridApiRef.current;
          setSortSummary(
            nextHasActiveSort && api ? getSalesOrderSortSummary(api) : null
          );
        }}
        onManagedRowDragReorder={(orderedRows) => {
          if (!reorderEnabled || reorderMutation.isPending) {
            return;
          }

          reorderMutation.mutate(orderedRows);
        }}
        className="flex h-[calc(100dvh_-_var(--height-nav)_-_var(--height-subnav))] min-h-0 flex-col gap-(--space-7) bg-[var(--color-bg)]"
        gridClassName="min-h-0 flex-1"
        height="100%"
        headerHeight={48}
        rowHeight={48}
        statusBarContent={
          <>
            <span>
              {displayedOrders.length} of {orders.length} rows
            </span>
            <LastSyncStatus dataUpdatedAt={dataUpdatedAt} />
            <div className="flex-1" />
            <button
              type="button"
              className="rounded-(--radius-sm) px-(--space-2) py-(--space-1) text-left transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-ink)] disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-[var(--color-ink-faint)]"
              disabled={!hasActiveSort}
              onClick={clearSort}
              title={hasActiveSort ? "Clear sort" : `Default sort: ${defaultSortSummary}`}
            >
              Sort: {displayedSortSummary}
            </button>
            <button
              type="button"
              className="rounded-(--radius-sm) px-(--space-2) py-(--space-1) text-left transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-ink)] disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-[var(--color-ink-faint)]"
              disabled={!hasActiveFilter}
              onClick={clearFilter}
              title={hasActiveFilter ? "Clear filter" : "Showing open orders"}
            >
              Filter: {filterSummary}
            </button>
            <span>v 4.12.2</span>
          </>
        }
      />
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedCount} order{selectedCount !== 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Open manufacturing orders created for the selected order
              {selectedCount !== 1 ? "s" : ""} and reservations will also be
              deleted or released. Shipped,
              inventory-consumed, or accounting-pushed orders cannot be deleted.
              This action cannot be undone.
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
