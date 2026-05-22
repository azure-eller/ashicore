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
import {
  type OperationalState,
} from "@/components/operational-state-cell";
import {
  Add01Icon,
  DatabaseExportIcon,
  Delete02Icon,
  Search01Icon,
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
import { Input } from "@/components/ui/input";
import { StatusLabel, type StatusTone } from "@/components/ui/status-label";
import { StatusRibbon } from "@/components/ui/status-ribbon";
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
  getSalesItemsFilterValue,
  getSalesItemsState,
  type SalesAllocationMode,
  type SalesItemsFilterValue,
} from "@/lib/sales/order-display-status";
import { ProductionActionCell } from "./sales-order-table-action-cells";
import { SalesStatusControl } from "@/components/sales/sales-status-control";
import type { SalesOrderListRow } from "./types";

function SalesDeliveryCell({ order }: { order: SalesOrderListRow }) {
  const queryClient = useQueryClient();
  return (
    <SalesStatusControl
      order={order}
      size="sm"
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

const availabilityToneByLabel: Record<string, StatusTone> = {
  Complete: "success",
  Allocated: "success",
  Partial: "warning",
  "Not allocated": "danger",
  Available: "success",
  Expected: "warning",
  "Not available": "danger",
};

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

function isThisWeek(dateString: string | null) {
  if (!dateString) return false;

  const [year, month, day] = dateString.split("-").map(Number);
  if (!year || !month || !day) return false;

  const date = new Date(year, month - 1, day);
  const today = new Date();
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  start.setDate(today.getDate() - today.getDay());

  const end = new Date(start);
  end.setDate(start.getDate() + 7);

  return date >= start && date < end;
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

function SalesItemsActionCell({
  order,
  allocationMode,
}: {
  order: SalesOrderListRow;
  allocationMode: SalesAllocationMode;
}) {
  const state = getSalesItemsState(order, allocationMode);
  const isActionLink =
    allocationMode === "manual"
      ? state.label === "Not allocated" || state.label === "Partial"
      : order.fulfillmentSummary.availabilityState === "not_available" ||
        order.fulfillmentSummary.availabilityState === "expected";
  const tone =
    availabilityToneByLabel[
      state.label.startsWith("Expected") ? "Expected" : state.label
    ] ?? "neutral";

  if (!isActionLink) {
    return <StatusLabel tone={tone}>{state.label}</StatusLabel>;
  }

  return (
    <Link
      href={`/sales/allocation?highlightOrderId=${order.id}`}
      className="block w-full outline-none focus-visible:shadow-[var(--focus-ring)]"
      aria-label="Open allocation status"
    >
      <StatusLabel tone={tone}>{state.label}</StatusLabel>
    </Link>
  );
}

function getProductionState(order: SalesOrderListRow): OperationalState {
  if (!order.hasManufacturableLines) {
    if (
      order.manufacturableDisabledReason ===
      "Allocated stock covers every manufacturable line."
    ) {
      return { label: "Allocated", tone: "success" };
    }

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
  searchValue: string,
  allocationMode: SalesAllocationMode
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
    getSalesItemsState(order, allocationMode).label,
    getProductionState(order).label,
    getDeliveryState(order).label,
  ].some((value) => value?.toLowerCase().includes(normalizedSearch));
}

function RankCell({ rowIndex, order }: { rowIndex: number; order: SalesOrderListRow }) {
  if (!isOpenSalesOrder(order)) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <div className="flex h-full min-w-0 items-center">
      <span className="block w-(--space-16) shrink-0 text-right text-muted-foreground tabular-nums">
        {order.priorityRank ?? rowIndex + 1}
      </span>
    </div>
  );
}

function FilterChip({
  active,
  label,
  ariaLabel,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  ariaLabel: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={ariaLabel}
      data-active={active ? "true" : undefined}
      className="group inline-flex h-(--height-input-sm) items-center gap-(--space-3) border border-border bg-card px-(--space-5) text-[length:var(--text-xs)] font-medium text-foreground transition-colors hover:bg-muted data-[active=true]:border-primary data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
      onClick={onClick}
    >
      {label}
      <span className="bg-foreground/10 px-(--space-2) font-mono text-[length:var(--text-2xs)] tabular-nums group-data-[active=true]:bg-primary-foreground/20">
        {count}
      </span>
    </button>
  );
}

export function OrdersTable({
  initialData,
  allocationMode,
}: {
  initialData: SalesOrderListRow[];
  allocationMode: SalesAllocationMode;
}) {
  return (
    <OrdersTableContent initialData={initialData} allocationMode={allocationMode} />
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

function OrdersTableContent({
  initialData,
  allocationMode,
}: {
  initialData: SalesOrderListRow[];
  allocationMode: SalesAllocationMode;
}) {
  const queryClient = useQueryClient();
  const gridApiRef = useRef<GridApi<SalesOrderListRow> | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [statusFilter, setStatusFilter] =
    useState<SalesWorkflowFilterValue>("open");
  const [allocationFilter, setAllocationFilter] =
    useState<SalesItemsFilterValue>("all");
  const [searchValue, setSearchValue] = useState("");
  const [selectedOrders, setSelectedOrders] = useState<SalesOrderListRow[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [hasActiveSort, setHasActiveSort] = useState(false);
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
  const readyFilter: SalesItemsFilterValue =
    allocationMode === "manual" ? "allocated" : "available";
  const middleFilter: SalesItemsFilterValue =
    allocationMode === "manual" ? "partial" : "expected";
  const shortFilter: SalesItemsFilterValue =
    allocationMode === "manual" ? "not_allocated" : "not_available";
  const readyLabel = allocationMode === "manual" ? "allocated" : "available";
  const middleLabel = allocationMode === "manual" ? "partial" : "expected";
  const shortLabel =
    allocationMode === "manual" ? "not allocated" : "not available";
  const columnHeader = allocationMode === "manual" ? "Allocation" : "Available";
  const readyCount = openOrders.filter(
    (order) => getSalesItemsFilterValue(order, allocationMode) === readyFilter
  ).length;
  const middleCount = openOrders.filter(
    (order) => getSalesItemsFilterValue(order, allocationMode) === middleFilter
  ).length;
  const shortCount = openOrders.filter(
    (order) => getSalesItemsFilterValue(order, allocationMode) === shortFilter
  ).length;
  const totalOpen = openOrders.reduce(
    (sum, order) => sum + (Number.parseFloat(order.totalAmount) || 0),
    0
  );
  const shipsThisWeek = openOrders.filter((order) =>
    isThisWeek(getOrderShipmentSchedule(order).date)
  ).length;
  const displayedOrders = useMemo(() => {
    const allowedStatuses =
      statusFilter === "done" ? DONE_SALES_STATUSES : OPEN_SALES_STATUSES;
    const filteredOrders = orders.filter(
      (order) =>
        (allowedStatuses as readonly string[]).includes(order.status) &&
        (statusFilter !== "open" ||
          allocationFilter === "all" ||
          getSalesItemsFilterValue(order, allocationMode) === allocationFilter) &&
        salesOrderMatchesSearch(order, searchValue, allocationMode)
    );

    if (statusFilter === "done") {
      return filteredOrders;
    }

    return [...filteredOrders].sort(compareSalesOrderRank);
  }, [allocationFilter, allocationMode, orders, searchValue, statusFilter]);
  const reorderEnabled =
    statusFilter === "open" && searchValue.trim() === "" && !hasActiveSort;
  const filterSummary =
    statusFilter === "done"
      ? "Done"
      : allocationFilter === "all"
        ? "Open"
        : allocationFilter === readyFilter
          ? readyLabel
          : allocationFilter === middleFilter
            ? middleLabel
            : shortLabel;
  const gridColumns = useMemo<ColDef<SalesOrderListRow>[]>(
    () => [
      {
        colId: "priorityRank",
        field: "priorityRank",
        headerName: "#",
        headerTooltip: SALES_ORDER_RANK_TOOLTIP,
        width: 92,
        minWidth: 88,
        maxWidth: 104,
        cellClass: "num",
        resizable: false,
        sortable: false,
        rowDrag: reorderEnabled,
        rowDragText: ({ defaultTextValue }) => `Move ${defaultTextValue}`,
        hide: statusFilter !== "open",
        cellRenderer: ({
          data,
          node,
        }: ICellRendererParams<SalesOrderListRow>) =>
          data ? (
            <RankCell rowIndex={node.rowIndex ?? 0} order={data} />
          ) : null,
        getQuickFilterText: () => "",
      },
      {
        field: "orderNumber",
        headerName: "Order",
        headerTooltip: SALES_ORDER_NUMBER_TOOLTIP,
        width: 130,
        minWidth: 130,
        cellClass: "mono",
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderListRow>) =>
          data ? (
            <Link
              href={`/sales/orders/${data.id}`}
              className="block truncate font-medium hover:underline"
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
        minWidth: 200,
        flex: 1,
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderListRow>) =>
          data ? (
            <span className="block truncate font-semibold">
              {data.customerName}
            </span>
          ) : null,
      },
      {
        field: "notes",
        headerName: "Notes",
        headerTooltip: SALES_ORDER_NOTES_TOOLTIP,
        minWidth: 200,
        flex: 1,
        cellClass: "muted",
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderListRow>) =>
          data ? <NotesCell notes={data.notes} /> : null,
        getQuickFilterText: ({ data }) => data?.notes ?? "",
      },
      {
        field: "totalAmount",
        headerName: "Total",
        headerTooltip: ORDER_TOTAL_TOOLTIP,
        width: 110,
        minWidth: 110,
        cellClass: "num",
        comparator: (left, right) =>
          parseFloat(String(left ?? "0")) - parseFloat(String(right ?? "0")),
        valueFormatter: ({ value }) => formatPrice(String(value ?? "")) ?? "—",
      },
      {
        colId: "allocation",
        headerName: columnHeader,
        headerTooltip: SALES_ORDER_ITEMS_STATUS_TOOLTIP,
        width: 140,
        minWidth: 140,
        valueGetter: ({ data }) =>
          data ? getSalesItemsState(data, allocationMode).label : "",
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderListRow>) =>
          data ? (
            <SalesItemsActionCell
              order={data}
              allocationMode={allocationMode}
            />
          ) : null,
        comparator: (_left, _right, leftNode, rightNode) =>
          parseQuantity(leftNode.data?.fulfillmentSummary.shortQty) -
          parseQuantity(rightNode.data?.fulfillmentSummary.shortQty),
      },
      {
        colId: "productionState",
        headerName: "Production",
        headerTooltip: SALES_ORDER_PRODUCTION_STATUS_TOOLTIP,
        width: 130,
        minWidth: 130,
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
        width: 130,
        minWidth: 130,
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
        headerName: "Ship by",
        headerTooltip: SALES_ORDER_SHIP_DATE_TOOLTIP,
        width: 100,
        minWidth: 100,
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
    [allocationMode, columnHeader, reorderEnabled, statusFilter]
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
  };

  return (
    <>
      <section className="flex h-[calc(100dvh_-_var(--height-nav)_-_var(--height-subnav))] min-h-0 flex-col bg-background">
        <div className="flex h-(--height-toolbar) shrink-0 items-center gap-(--space-5) border-b border-border bg-card px-(--space-8)">
          <div className="relative w-[260px]">
            <HugeiconsIcon
              icon={Search01Icon}
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-(--space-4) size-(--space-7) -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={searchInputRef}
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="Search orders, customers, PO..."
              aria-label="Search orders, customers, PO"
              className="h-(--height-input-sm) bg-muted pl-(--space-12)"
            />
          </div>
          <div
            role="radiogroup"
            aria-label="Filter sales orders by workflow"
            className="flex items-center gap-(--space-2)"
          >
            <FilterChip
              active={statusFilter === "open"}
              label="Open"
              ariaLabel="Show open orders"
              count={openCount}
              onClick={() => {
                setStatusFilter("open");
              }}
            />
            <FilterChip
              active={statusFilter === "done"}
              label="Done"
              ariaLabel="Show done orders"
              count={doneCount}
              onClick={() => {
                setStatusFilter("done");
                setAllocationFilter("all");
              }}
            />
          </div>
          {hasActiveSort ? (
            <>
              <div className="h-(--space-10) w-px bg-border" />
              <div className="flex items-center gap-(--space-2)">
                <Button type="button" variant="secondary" size="sm" onClick={clearSort}>
                  <HugeiconsIcon icon={Sorting05Icon} data-icon="inline-start" />
                  Reset sort
                </Button>
              </div>
            </>
          ) : null}
          <div className="flex-1" />
          <Button
            type="button"
            variant="secondary"
            size="sm"
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
            className="relative"
            aria-label={
              selectedCount > 0
                ? `Delete ${selectedCount} selected`
                : "Delete selected"
            }
            onClick={() => setDeleteDialogOpen(true)}
          >
            <HugeiconsIcon icon={Delete02Icon} aria-hidden />
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
            <Link href="/sales/order">
              <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
              New Order
            </Link>
          </Button>
        </div>
        <StatusRibbon>
          <StatusRibbon.Stat
            tone="info"
            count={openCount}
            label="open"
            active={statusFilter === "open" && allocationFilter === "all"}
            aria-label={`Filter by open (${openCount} orders)`}
            onClick={() => {
              setStatusFilter("open");
              setAllocationFilter("all");
            }}
          />
          <StatusRibbon.Stat
            tone="success"
            count={readyCount}
            label={readyLabel}
            active={allocationFilter === readyFilter}
            aria-label={`Filter by ${readyLabel} (${readyCount} orders)`}
            onClick={() => {
              setStatusFilter("open");
              setAllocationFilter(readyFilter);
            }}
          />
          <StatusRibbon.Stat
            tone="warning"
            count={middleCount}
            label={middleLabel}
            active={allocationFilter === middleFilter}
            aria-label={`Filter by ${middleLabel} (${middleCount} orders)`}
            onClick={() => {
              setStatusFilter("open");
              setAllocationFilter(middleFilter);
            }}
          />
          <StatusRibbon.Stat
            tone="danger"
            count={shortCount}
            label={shortLabel}
            active={allocationFilter === shortFilter}
            aria-label={`Filter by ${shortLabel} (${shortCount} orders)`}
            onClick={() => {
              setStatusFilter("open");
              setAllocationFilter(shortFilter);
            }}
          />
          <StatusRibbon.Spacer />
          <StatusRibbon.Stat
            label="Total open:"
            value={formatPrice(String(totalOpen)) ?? "$0.00"}
          />
          <StatusRibbon.Stat label="Ships this week:" value={shipsThisWeek} />
        </StatusRibbon>
        <ERPDataGrid
          rows={displayedOrders}
          columns={gridColumns}
          searchValue={searchValue}
          emptyMessage="No sales orders yet."
          enableRowSelection
          onSelectionChange={setSelectedOrders}
          enableManagedRowDrag={reorderEnabled}
          suppressMoveWhenRowDragging
          resetRowDataOnUpdate
          onGridReady={(event) => {
            gridApiRef.current = event.api;
          }}
          onSortChange={setHasActiveSort}
          onManagedRowDragReorder={(orderedRows) => {
            if (!reorderEnabled || reorderMutation.isPending) {
              return;
            }

            reorderMutation.mutate(orderedRows);
          }}
          className="min-h-0 flex-1 space-y-0"
          height="100%"
        />
        <div className="flex h-(--height-statusbar) shrink-0 items-center gap-(--space-6) border-t border-border bg-card px-(--space-8) text-[length:var(--text-xs)] text-muted-foreground tabular-nums">
          <span>
            {displayedOrders.length} of {orders.length} rows
          </span>
          <LastSyncStatus dataUpdatedAt={dataUpdatedAt} />
          <div className="flex-1" />
          <button type="button" className="hover:text-foreground" onClick={clearSort}>
            Sort: {hasActiveSort ? "Custom" : "Ship by ↑"}
          </button>
          <button
            type="button"
            className="hover:text-foreground"
            onClick={() => {
              setStatusFilter("open");
              setAllocationFilter("all");
            }}
          >
            Filter: {filterSummary}
          </button>
          <span>v 4.12.2</span>
        </div>
      </section>
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
