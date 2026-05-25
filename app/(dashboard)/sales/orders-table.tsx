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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { StatusBlock, type StatusBlockTone } from "@/components/ui/status-block";
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
import { formatDate, formatPrice, formatQuantity } from "@/lib/format";
import { displaySalesOrderNotes } from "@/lib/sales/import-notes";
import {
  getSalesItemsAvailabilityState,
  getSalesItemsState,
  type SalesAllocationMode,
} from "@/lib/sales/order-display-status";
import {
  getIngredientsDisplayState,
  getProductionDisplayState,
  type FulfillmentDisplayState,
  type FulfillmentTone,
} from "@/lib/sales/fulfillment-status";
import { ProductionActionCell } from "./sales-order-table-action-cells";
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

const fulfillmentToneToStatusBlockTone: Record<FulfillmentTone, StatusBlockTone> = {
  destructive: "danger",
  muted: "muted",
  secondary: "warning",
  success: "success",
  warning: "warning",
};

function isOpenSalesOrder(order: SalesOrderListRow) {
  return (OPEN_SALES_STATUSES as readonly string[]).includes(order.status);
}

function NotesCell({ notes }: { notes: string | null }) {
  const trimmedNotes = displaySalesOrderNotes(notes);

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
    ? `${line.attrs.join(" / ")} ${line.masterName}`
    : line.masterName;
}

function getStockCoverage({
  requiredQty,
  shortQty,
}: {
  requiredQty: string;
  shortQty: string;
}) {
  const required = parseQuantity(requiredQty);
  const short = parseQuantity(shortQty);
  const available = Math.max(0, required - short);

  return {
    needed: formatQuantity(requiredQty),
    available: formatQuantity(String(available)),
  };
}

function DetailMenuTable({
  emptyMessage,
  rows,
}: {
  emptyMessage: string;
  rows: Array<{
    id: string;
    item: string;
    needed: string;
    available: string;
  }>;
}) {
  if (rows.length === 0) {
    return (
      <div className="px-(--space-3) py-(--space-4) text-[length:var(--text-sm)] text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="max-h-[320px] overflow-y-auto">
      <div className="grid grid-cols-[minmax(0,1fr)_64px_64px] gap-x-(--space-5) border-b border-border px-(--space-3) py-(--space-2) text-[length:var(--text-xs)] font-medium text-muted-foreground">
        <div>Item</div>
        <div className="text-right">Needed</div>
        <div className="text-right">Available</div>
      </div>
      {rows.map((row) => (
        <div
          key={row.id}
          className="grid grid-cols-[minmax(0,1fr)_64px_64px] items-start gap-x-(--space-5) border-b border-border/60 px-(--space-3) py-(--space-3) text-[length:var(--text-sm)] last:border-b-0"
        >
          <div className="min-w-0 truncate font-medium">{row.item}</div>
          <div className="text-right font-mono text-[length:var(--text-xs)] tabular-nums text-muted-foreground">
            {row.needed}
          </div>
          <div className="text-right font-mono text-[length:var(--text-xs)] tabular-nums text-muted-foreground">
            {row.available}
          </div>
        </div>
      ))}
    </div>
  );
}

function SalesItemsActionCell({
  order,
}: {
  order: SalesOrderListRow;
}) {
  const state = getSalesItemsAvailabilityState(order);
  const tone = fulfillmentToneToStatusBlockTone[state.tone];
  const hasManualReservation =
    parseQuantity(order.fulfillmentSummary.manualReservationQty) > 0;
  const manualReservationTitle = hasManualReservation
    ? `Manual reservation${
        order.fulfillmentSummary.manualReservationSummary
          ? `: ${order.fulfillmentSummary.manualReservationSummary}`
          : ""
      }`
    : undefined;
  const rows = order.lines.map((line) => ({
    id: line.id ?? line.itemId,
    item: formatOrderLineItemName(line),
    needed: formatQuantity(line.remainingQty ?? line.quantity),
    available: formatQuantity(line.demandQueueInStockQty ?? "0"),
  }));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <StatusBlock
          tone={tone}
          actionable
          actionVariant="button"
          marker={hasManualReservation ? "M" : undefined}
          title={manualReservationTitle}
          onClick={(event) => event.stopPropagation()}
          aria-label={`Sales items: ${state.label}`}
        >
          {state.label}
        </StatusBlock>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[560px]">
        <DropdownMenuLabel>Sales items</DropdownMenuLabel>
        <DetailMenuTable emptyMessage="No sales items." rows={rows} />
      </DropdownMenuContent>
    </DropdownMenu>
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
    ...getStockCoverage({
      requiredQty: shortage.requiredQty,
      shortQty: shortage.shortQty,
    }),
  }));

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
      <DropdownMenuContent align="start" className="w-[560px]">
        <DropdownMenuLabel>Short ingredients</DropdownMenuLabel>
        <DetailMenuTable
          emptyMessage={
            state.label === "Not needed"
              ? "Finished goods cover this order."
              : state.label === "Not applicable"
                ? "No manufacturable items on this order."
                : "No ingredient shortages."
          }
          rows={rows}
        />
      </DropdownMenuContent>
    </DropdownMenu>
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
    getIngredientsState(order).label,
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
  const hasAutoSizedColumnsRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [statusFilter, setStatusFilter] =
    useState<SalesWorkflowFilterValue>("open");
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
  const displayedOrders = useMemo(() => {
    const allowedStatuses =
      statusFilter === "done" ? DONE_SALES_STATUSES : OPEN_SALES_STATUSES;
    const filteredOrders = orders.filter(
      (order) =>
        (allowedStatuses as readonly string[]).includes(order.status) &&
        salesOrderMatchesSearch(order, searchValue, allocationMode)
    );

    if (statusFilter === "done") {
      return filteredOrders;
    }

    return [...filteredOrders].sort(compareSalesOrderRank);
  }, [allocationMode, orders, searchValue, statusFilter]);
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
  const reorderEnabled = statusFilter === "open";
  const filterSummary = statusFilter === "done" ? "Done" : "Open";
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
        cellClass: "num regular",
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
          data ? getSalesItemsAvailabilityState(data).label : "",
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
        headerName: "Ship by",
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
