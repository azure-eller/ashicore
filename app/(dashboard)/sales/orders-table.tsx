"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ICellRendererParams, RowDragEndEvent } from "ag-grid-community";
import { apiJson } from "@/lib/client/api";
import { ERPDataGrid, type ColDef } from "@/components/erp-data-grid";
import {
  OperationalStateCell,
  type OperationalState,
} from "@/components/operational-state-cell";
import {
  Add01Icon,
  Delete02Icon,
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
  DeliveryActionCell,
  ProductionActionCell,
} from "./sales-order-table-action-cells";
import type { SalesOrderListRow } from "./types";

const OPEN_SALES_STATUSES = ["open"] as const;
const DONE_SALES_STATUSES = ["done"] as const;
type SalesWorkflowFilterValue = "open" | "done";

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

function getSalesItemsState(order: SalesOrderListRow): OperationalState {
  if (order.status === "done") {
    return { label: "Complete", tone: "success" };
  }

  const remainingQty = parseQuantity(order.fulfillmentSummary.remainingQty);
  const allocatedQty = parseQuantity(order.fulfillmentSummary.allocatedQty);
  const shortQty = parseQuantity(order.fulfillmentSummary.shortQty);

  if (remainingQty <= 0) {
    return { label: "Complete", tone: "success" };
  }

  if (shortQty <= 0) {
    return { label: "Allocated", tone: "success" };
  }

  if (allocatedQty > 0) {
    return { label: "Partial", tone: "warning" };
  }

  return { label: "Not allocated", tone: "destructive" };
}

function shippedSalesQuantity(order: SalesOrderListRow) {
  return order.lines.reduce(
    (sum, line) => sum + parseQuantity(line.shippedQuantity),
    0
  );
}

function shippedShipmentCount(order: SalesOrderListRow) {
  return order.shipments.filter((shipment) => shipment.status === "shipped").length;
}

function activeShipmentCount(order: SalesOrderListRow) {
  return order.shipments.length;
}

function SalesItemsActionCell({ order }: { order: SalesOrderListRow }) {
  const state = getSalesItemsState(order);
  const isAllocationLink =
    state.label === "Not allocated" || state.label === "Partial";

  if (!isAllocationLink) {
    return <OperationalStateCell state={state} />;
  }

  return (
    <Link
      href={`/sales/allocation?highlightOrderId=${order.id}`}
      className="block w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Open allocation status"
    >
      <OperationalStateCell
        state={state}
        className="transition-colors hover:border-primary/40 hover:bg-primary/10"
      />
    </Link>
  );
}

function getProductionState(order: SalesOrderListRow): OperationalState {
  if (!order.hasManufacturableLines) {
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
    const shippedCount = shippedShipmentCount(order);
    const activeCount = activeShipmentCount(order);
    const label =
      shippedCount > 0 && activeCount > 1
        ? `Partially shipped (${shippedCount}/${activeCount})`
        : "Partially shipped";
    return { label, tone: "warning" };
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

function salesOrderMatchesSearch(order: SalesOrderListRow, searchValue: string) {
  const normalizedSearch = searchValue.trim().toLowerCase();

  if (!normalizedSearch) {
    return true;
  }

  return [
    order.orderNumber,
    order.customerName,
    order.notes,
    order.totalAmount,
    order.shipDate,
    getSalesItemsState(order).label,
    getProductionState(order).label,
    getDeliveryState(order).label,
  ].some((value) => value?.toLowerCase().includes(normalizedSearch));
}

function RankCell({ rowIndex, order }: { rowIndex: number; order: SalesOrderListRow }) {
  if (!isOpenSalesOrder(order)) {
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

export function OrdersTable({ initialData }: { initialData: SalesOrderListRow[] }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <OrdersTableContent initialData={initialData} />
    </QueryClientProvider>
  );
}

function OrdersTableContent({ initialData }: { initialData: SalesOrderListRow[] }) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] =
    useState<SalesWorkflowFilterValue>("open");
  const [searchValue, setSearchValue] = useState("");
  const [selectedOrders, setSelectedOrders] = useState<SalesOrderListRow[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [hasActiveSort, setHasActiveSort] = useState(false);
  const { data: orders = initialData } = useQuery({
    queryKey: ["sales-orders"],
    queryFn: () =>
      apiJson<SalesOrderListRow[]>("/api/sales-orders", {
        fallbackError: "Failed to fetch orders.",
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
  const reorderEnabled =
    statusFilter === "open" && searchValue.trim() === "" && !hasActiveSort;
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
        minWidth: 130,
        flex: 0.8,
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderListRow>) =>
          data ? (
            <Link
              href={`/sales/orders/${data.id}`}
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
        minWidth: 190,
        flex: 1.4,
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderListRow>) =>
          data ? <span className="block truncate">{data.customerName}</span> : null,
      },
      {
        field: "notes",
        headerName: "Notes",
        headerTooltip: SALES_ORDER_NOTES_TOOLTIP,
        width: 240,
        minWidth: 180,
        flex: 1.2,
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderListRow>) =>
          data ? <NotesCell notes={data.notes} /> : null,
        getQuickFilterText: ({ data }) => data?.notes ?? "",
      },
      {
        field: "totalAmount",
        headerName: "Total",
        headerTooltip: ORDER_TOTAL_TOOLTIP,
        width: 135,
        minWidth: 115,
        comparator: (left, right) =>
          parseFloat(String(left ?? "0")) - parseFloat(String(right ?? "0")),
        valueFormatter: ({ value }) => formatPrice(String(value ?? "")) ?? "—",
      },
      {
        colId: "allocation",
        headerName: "Allocation",
        headerTooltip: SALES_ORDER_ITEMS_STATUS_TOOLTIP,
        width: 165,
        minWidth: 145,
        valueGetter: ({ data }) => (data ? getSalesItemsState(data).label : ""),
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderListRow>) =>
          data ? <SalesItemsActionCell order={data} /> : null,
        comparator: (_left, _right, leftNode, rightNode) =>
          parseQuantity(leftNode.data?.fulfillmentSummary.shortQty) -
          parseQuantity(rightNode.data?.fulfillmentSummary.shortQty),
      },
      {
        colId: "productionState",
        headerName: "Production",
        headerTooltip: SALES_ORDER_PRODUCTION_STATUS_TOOLTIP,
        width: 170,
        minWidth: 150,
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
        width: 175,
        minWidth: 155,
        valueGetter: ({ data }) => (data ? getDeliveryState(data).label : ""),
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderListRow>) =>
          data ? (
            <DeliveryActionCell
              order={data}
              state={getDeliveryState(data)}
            />
          ) : null,
        comparator: (_left, _right, leftNode, rightNode) => {
          const leftOrder = leftNode.data;
          const rightOrder = rightNode.data;

          if (!leftOrder || !rightOrder) return 0;

          const doneRank =
            doneSalesOrderRank(leftOrder) - doneSalesOrderRank(rightOrder);
          if (doneRank !== 0) return doneRank;

          return (leftOrder.shipDate ?? "").localeCompare(
            rightOrder.shipDate ?? ""
          );
        },
      },
      {
        field: "shipDate",
        headerName: "Ship by",
        headerTooltip: SALES_ORDER_SHIP_DATE_TOOLTIP,
        width: 130,
        minWidth: 115,
        valueFormatter: ({ value }) => formatDate(value as string | null),
        comparator: (left, right, leftNode, rightNode) => {
          const dateCompare = String(left ?? "").localeCompare(String(right ?? ""));

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
      await queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
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

  return (
    <>
      <ERPDataGrid
        rows={displayedOrders}
        columns={gridColumns}
        searchAriaLabel="Search orders"
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        emptyMessage="No sales orders yet."
        enableRowSelection
        onSelectionChange={setSelectedOrders}
        enableManagedRowDrag={reorderEnabled && !reorderMutation.isPending}
        suppressMoveWhenRowDragging
        resetRowDataOnUpdate
        onSortChange={setHasActiveSort}
        onManagedRowDragReorder={(orderedRows) => {
          if (!reorderEnabled || reorderMutation.isPending) {
            return;
          }

          reorderMutation.mutate(orderedRows);
        }}
        toolbarContent={
          <SalesOrderWorkflowTabs
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
              <Link href="/sales/orders/new">
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
              Delete {selectedCount} order{selectedCount !== 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Open manufacturing orders created for the selected order
              {selectedCount !== 1 ? "s" : ""}, planned shipments and their draft
              costs, and reservations will also be deleted or released. Shipped,
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

function SalesOrderWorkflowTabs({
  value,
  statusCounts,
  onStatusChange,
}: {
  value: SalesWorkflowFilterValue;
  statusCounts: Map<string, number>;
  onStatusChange: (status: SalesWorkflowFilterValue) => void;
}) {
  const openCount = OPEN_SALES_STATUSES.reduce(
    (sum, status) => sum + (statusCounts.get(status) ?? 0),
    0
  );
  const doneCount = DONE_SALES_STATUSES.reduce(
    (sum, status) => sum + (statusCounts.get(status) ?? 0),
    0
  );
  const applyFilter = (nextValue: SalesWorkflowFilterValue) => {
    onStatusChange(nextValue);
  };

  return (
    <ToggleGroup
      type="single"
      variant="segmented"
      size="sm"
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue === "open" || nextValue === "done") {
          applyFilter(nextValue);
        }
      }}
      aria-label="Filter sales orders by workflow"
      className="max-w-full flex-wrap rounded-lg bg-muted p-1"
    >
      <ToggleGroupItem
        value="open"
        aria-label="Show open orders"
        className="gap-1.5"
        onClick={() => applyFilter("open")}
      >
        Open
        <span className="text-muted-foreground">{openCount}</span>
      </ToggleGroupItem>
      <ToggleGroupItem
        value="done"
        aria-label="Show done orders"
        className="gap-1.5"
        onClick={() => applyFilter("done")}
      >
        Done
        <span className="text-muted-foreground">{doneCount}</span>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
