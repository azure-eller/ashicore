"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  CellClickedEvent,
  GridApi,
  ICellRendererParams,
} from "ag-grid-community";
import { apiJson } from "@/lib/client/api";
import { ERPDataGrid, type ColDef } from "@/components/erp-data-grid";
import { SelectionCountBadge } from "@/components/selection-count-badge";
import { WorkflowStatusFilter } from "@/components/workflow-status-filter";
import {
  Add01Icon,
  DatabaseExportIcon,
  Delete02Icon,
  Sorting05Icon,
  Tick02Icon,
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
import { StatusDetailMenuTable } from "@/components/status-detail-menu-table";
import { FulfillmentStatusBlock } from "@/components/fulfillment-status-block";
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
  ingredientsStatusEmptyMessage,
} from "./sales-order-table-action-cells";
import {
  isSalesOrderStatusDisabled,
  salesOrderStatusConfig,
  type SalesOrderStatusContext,
} from "@/components/card-page/order-status-configs";
import {
  CreateManufacturingOrdersDialog,
  defaultManufacturingPlannedDate,
} from "./create-manufacturing-orders-dialog";
import type { SalesOrderListRow } from "./types";

const OPEN_SALES_STATUSES = ["open"] as const;
const DONE_SALES_STATUSES = ["done"] as const;
type SalesWorkflowFilterValue = "open" | "done";

type SalesOrderGridRow = SalesOrderListRow & {
  __grid: {
    notesLabel: string;
    salesItemsState: FulfillmentDisplayState;
    salesItemsLabel: string;
    salesItemsActionable: boolean;
    salesItemsCellClass: string[];
    ingredientsState: FulfillmentDisplayState;
    ingredientsLabel: string;
    ingredientsCellClass: string[];
    productionState: FulfillmentDisplayState;
    productionLabel: string;
    productionActionable: boolean;
    productionCellClass: string[];
    deliveryState: FulfillmentDisplayState;
    deliveryLabel: string;
    deliveryActionable: boolean;
    deliveryCellClass: string[];
    shipDate: string | null;
    shipDateLabel: string;
  };
};

const SALES_ORDER_AUTO_SIZE_COLUMN_IDS = [
  "orderNumber",
  "allocation",
  "ingredientsState",
  "deliveryState",
  "shipDate",
] as const;

function autoSizeSalesOrderStatusColumns(api: GridApi<SalesOrderGridRow>) {
  window.requestAnimationFrame(() => {
    api.autoSizeColumns([...SALES_ORDER_AUTO_SIZE_COLUMN_IDS], true);
  });
}

function isOpenSalesOrder(order: SalesOrderListRow) {
  return (OPEN_SALES_STATUSES as readonly string[]).includes(order.status);
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

function getSalesItemsStateForOrder(order: SalesOrderListRow) {
  return order.lines.length === 0
    ? ({ label: "Not applicable", tone: "muted" } satisfies FulfillmentDisplayState)
    : getSalesItemsAvailabilityState(order);
}

function buildSalesItemsRows(order: SalesOrderListRow) {
  return order.lines.map((line) => ({
    id: line.id ?? line.itemId,
    item: formatOrderLineItemName(line),
    needed: formatQuantity(line.remainingQty ?? line.quantity),
    available: formatQuantity(line.demandQueueInStockQty ?? "0"),
    expected: formatQuantity(line.demandQueueExpectedQty ?? "0"),
  }));
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

function buildIngredientRows(order: SalesOrderListRow) {
  return order.fulfillmentSummary.ingredientShortages.map((shortage) => ({
    id: shortage.itemId,
    item: shortage.itemName,
    needed: formatQuantity(shortage.requiredQty),
    available: formatQuantity(shortage.availableQty),
    expected: formatQuantity(shortage.expectedQty),
    short: shortage.availabilityStatus === "missing",
  }));
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

const STATUS_CELL_COLUMN_IDS = new Set([
  "allocation",
  "ingredientsState",
  "productionState",
  "deliveryState",
]);
const STATUS_PANEL_OVERLAY_SELECTOR = [
  "[data-sales-order-status-panel]",
  "[data-slot='dropdown-menu-content']",
  "[data-slot='dialog-content']",
  "[data-slot='dialog-overlay']",
  "[role='menu']",
  "[role='dialog']",
  "[data-radix-popper-content-wrapper]",
].join(",");
const OPEN_STATUS_PANEL_MENU_SELECTOR =
  "[data-slot='dropdown-menu-content'][data-state='open'], [role='menu'][data-state='open']";
const STATUS_PANEL_WIDTH = 560;
const STATUS_PANEL_MARGIN = 12;
const DELIVERY_STATUS_SWATCH: Record<string, string> = {
  neutral: "bg-[var(--color-muted-solid)]",
  info: "bg-[var(--color-muted-solid)]",
  warning: "bg-[var(--color-warning-solid)]",
  danger: "bg-[var(--color-danger-solid)]",
  success: "bg-[var(--color-success-solid)]",
  accent: "bg-[var(--color-warning-solid)]",
};

type SalesOrderPanelKind =
  | "allocation"
  | "ingredientsState"
  | "productionState"
  | "deliveryState";

type SalesOrderPanelState = {
  kind: SalesOrderPanelKind;
  orderId: string;
  x: number;
  y: number;
};

function isStatusPanelActionable(
  order: SalesOrderGridRow,
  kind: SalesOrderPanelKind
) {
  if (kind === "allocation") return order.__grid.salesItemsActionable;
  if (kind === "productionState") return order.__grid.productionActionable;
  if (kind === "deliveryState") return order.__grid.deliveryActionable;
  return true;
}

function statusCellClass(options?: { actionable?: boolean }) {
  return [
    "statusBlockCell",
    options?.actionable !== false ? "statusInteractiveCell" : "",
  ].filter(Boolean);
}

function isProductionStatusActionable(
  order: SalesOrderListRow,
  state: FulfillmentDisplayState
) {
  return (
    order.openManufacturingOrders.length > 0 ||
    (order.status === "open" && state.label === "Make")
  );
}

function isStatusPanelOverlayTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    target.closest(STATUS_PANEL_OVERLAY_SELECTOR) !== null
  );
}

function hasOpenStatusPanelOverlay() {
  return document.querySelector(OPEN_STATUS_PANEL_MENU_SELECTOR);
}

function isOpenStatusPanelOverlayTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    target.closest(OPEN_STATUS_PANEL_MENU_SELECTOR) !== null
  );
}

function panelPosition(event: MouseEvent | undefined) {
  const x = event?.clientX ?? 240;
  const y = event?.clientY ?? 160;

  if (typeof window === "undefined") {
    return { x, y };
  }

  const panelWidth = Math.min(STATUS_PANEL_WIDTH, window.innerWidth - STATUS_PANEL_MARGIN * 2);

  return {
    x: Math.max(
      STATUS_PANEL_MARGIN,
      Math.min(x, window.innerWidth - panelWidth - STATUS_PANEL_MARGIN)
    ),
    y: Math.max(STATUS_PANEL_MARGIN, Math.min(y + 10, window.innerHeight - 420)),
  };
}

function buildSalesOrderGridRow(order: SalesOrderListRow): SalesOrderGridRow {
  const salesItemsState = getSalesItemsStateForOrder(order);
  const ingredientsState = getIngredientsState(order);
  const productionState = getProductionState(order);
  const deliveryState = getDeliveryState(order);
  const shipmentSchedule = getOrderShipmentSchedule(order);
  const salesItemsActionable = order.lines.length > 0;
  const productionActionable = isProductionStatusActionable(order, productionState);
  const deliveryActionable = !isSalesOrderStatusDisabled(order);

  return {
    ...order,
    __grid: {
      notesLabel: displaySalesOrderNotes(order.notes) ?? "—",
      salesItemsState,
      salesItemsLabel: salesItemsState.label,
      salesItemsActionable,
      salesItemsCellClass: statusCellClass({
        actionable: salesItemsActionable,
      }),
      ingredientsState,
      ingredientsLabel: ingredientsState.label,
      ingredientsCellClass: statusCellClass(),
      productionState,
      productionLabel: productionState.label,
      productionActionable,
      productionCellClass: statusCellClass({
        actionable: productionActionable,
      }),
      deliveryState,
      deliveryLabel: deliveryState.label,
      deliveryActionable,
      deliveryCellClass: statusCellClass({
        actionable: deliveryActionable,
      }),
      shipDate: shipmentSchedule.date,
      shipDateLabel: shipmentSchedule.label,
    },
  };
}

function StatusCell({ state }: { state: FulfillmentDisplayState }) {
  return <FulfillmentStatusBlock state={state} />;
}

function PanelActionButton({
  children,
  disabled,
  leading,
  active,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  leading?: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        "flex h-(--height-menu-item) w-full items-center gap-(--space-3) rounded-(--radius-md) px-(--space-3) text-left text-[length:var(--text-control)]",
        active ? "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]" : "",
        disabled && !active
          ? "cursor-not-allowed opacity-50"
          : "cursor-pointer hover:bg-[var(--color-surface-alt)]",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {leading}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {active ? <HugeiconsIcon icon={Tick02Icon} size={14} aria-hidden /> : null}
    </button>
  );
}

function SalesDeliveryPanelContent({
  order,
  onClose,
}: {
  order: SalesOrderListRow;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [dialogTarget, setDialogTarget] = useState<string | null>(null);
  const ctx: SalesOrderStatusContext = { order };
  const current = salesOrderStatusConfig.current(ctx);
  const options = salesOrderStatusConfig.options(ctx);
  const disabled = isSalesOrderStatusDisabled(order);

  const handleDone = (status?: string) => {
    setDialogTarget(null);
    onClose();
    void status;
    void queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
    void queryClient.invalidateQueries({ queryKey: ["items"] });
  };

  return (
    <>
      <div className="grid gap-(--space-1)">
        {options.map((option) => {
          const active = option.value === current;
          const kind = salesOrderStatusConfig.transitionKind(current, option.value, ctx);
          const selectable = !disabled && (kind === "instant" || kind === "dialog");

          return (
            <PanelActionButton
              key={option.value}
              active={active}
              disabled={!selectable && !active}
              leading={
                <span
                  className={`inline-block size-(--space-6) rounded-(--radius-full) ${
                    DELIVERY_STATUS_SWATCH[option.tone]
                  }`}
                />
              }
              onClick={() => {
                if (!selectable) return;
                if (kind === "dialog") setDialogTarget(option.value);
              }}
            >
              {option.label}
            </PanelActionButton>
          );
        })}
      </div>
      {dialogTarget && salesOrderStatusConfig.renderDialog
        ? salesOrderStatusConfig.renderDialog({
            to: dialogTarget,
            ctx,
            onClose: () => setDialogTarget(null),
            onDone: handleDone,
          })
        : null}
    </>
  );
}

function ProductionPanelContent({ order }: { order: SalesOrderListRow }) {
  const state = getProductionState(order);
  const [makeToOrderOpen, setMakeToOrderOpen] = useState(false);
  const [manufacturingStrategy, setManufacturingStrategy] =
    useState<"make_to_order" | "make_to_stock">("make_to_order");
  const isMakeAction = order.status === "open" && state.label === "Make";
  const hasOpenManufacturingOrders = order.openManufacturingOrders.length > 0;

  if (!isMakeAction && !hasOpenManufacturingOrders) {
    return (
      <div className="text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">
        No production actions available.
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-(--space-1)">
        {isMakeAction ? (
          <>
            <PanelActionButton
              leading={<HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-(--space-8)" />}
              onClick={() => {
                setManufacturingStrategy("make_to_order");
                setMakeToOrderOpen(true);
              }}
            >
              Make to order
            </PanelActionButton>
            <PanelActionButton
              leading={<HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-(--space-8)" />}
              onClick={() => {
                setManufacturingStrategy("make_to_stock");
                setMakeToOrderOpen(true);
              }}
            >
              Make to stock
            </PanelActionButton>
          </>
        ) : null}
        {hasOpenManufacturingOrders ? (
          <>
            <div className="px-(--space-3) pt-(--space-2) pb-(--space-1) font-mono text-[length:var(--text-xs)] font-bold uppercase tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)]">
              Manufacturing orders
            </div>
            {order.openManufacturingOrders.map((mo) => (
              <Link
                key={mo.id}
                href={`/manufacturing/order/${mo.id}`}
                className="grid min-w-0 gap-(--space-1) rounded-(--radius-md) px-(--space-3) py-(--space-3) hover:bg-[var(--color-surface-alt)]"
              >
                <div className="truncate font-mono text-[length:var(--text-sm)] font-semibold">
                  {mo.orderNumber}
                </div>
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-(--space-4) text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                  <span className="truncate">{mo.productName}</span>
                  <span className="font-mono tabular-nums">
                    {mo.plannedQuantity} {mo.unitName}
                  </span>
                </div>
                <div className="truncate font-mono text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                  Deadline {mo.plannedDate ? formatDate(mo.plannedDate) : "—"}
                </div>
              </Link>
            ))}
          </>
        ) : null}
      </div>
      <CreateManufacturingOrdersDialog
        salesOrderId={order.id}
        open={makeToOrderOpen}
        onOpenChange={setMakeToOrderOpen}
        showTrigger={false}
        manufacturingStrategy={manufacturingStrategy}
        salesOrderLabel={`${order.orderNumber} - ${order.customerName}`}
        initialPlannedDate={defaultManufacturingPlannedDate(order.shipDate ?? null)}
        openManufacturingOrders={order.openManufacturingOrders.map((mo) => ({
          id: mo.id,
          orderNumber: mo.orderNumber,
          itemName: mo.productName,
          quantity: `${mo.plannedQuantity} ${mo.unitName}`,
          plannedDate: mo.plannedDate,
          priorityRank: mo.priorityRank,
          status: mo.status,
        }))}
      />
    </>
  );
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

function SalesOrderStatusPanel({
  panel,
  order,
  onClose,
}: {
  panel: SalesOrderPanelState | null;
  order: SalesOrderListRow | null;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!panel) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (isStatusPanelOverlayTarget(event.target)) return;

      onClose();
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose, panel]);

  useEffect(() => {
    if (!panel) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (
        isOpenStatusPanelOverlayTarget(event.target) ||
        hasOpenStatusPanelOverlay()
      ) {
        return;
      }

      onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, panel]);

  if (!panel || !order) return null;

  const titleByKind: Record<SalesOrderPanelKind, string> = {
    allocation: "Sales items",
    ingredientsState: "Ingredients",
    productionState: "Production",
    deliveryState: "Delivery",
  };
  const title = titleByKind[panel.kind];

  return (
    <div
      ref={panelRef}
      data-sales-order-status-panel
      className="fixed z-50 w-[min(560px,calc(100vw_-_24px))] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-grid-card)]"
      style={{ left: panel.x, top: panel.y }}
    >
      <div className="flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface-alt)] px-(--space-5) py-(--space-4)">
        <div className="min-w-0">
          <div className="font-mono text-[length:var(--text-xs)] font-bold uppercase tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)]">
            {title}
          </div>
          <div className="truncate text-[length:var(--text-sm)] font-semibold">
            {order.orderNumber} · {order.customerName}
          </div>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="max-h-[360px] overflow-y-auto p-(--space-5)">
        {panel.kind === "allocation" ? (
          <StatusDetailMenuTable
            emptyMessage="No sales items."
            rows={buildSalesItemsRows(order)}
          />
        ) : null}
        {panel.kind === "ingredientsState" ? (
          <StatusDetailMenuTable
            emptyMessage={ingredientsStatusEmptyMessage(
              getIngredientsState(order),
              "order"
            )}
            rows={buildIngredientRows(order)}
          />
        ) : null}
        {panel.kind === "productionState" ? (
          <ProductionPanelContent order={order} />
        ) : null}
        {panel.kind === "deliveryState" ? (
          <SalesDeliveryPanelContent order={order} onClose={onClose} />
        ) : null}
      </div>
    </div>
  );
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
  const gridApiRef = useRef<GridApi<SalesOrderGridRow> | null>(null);
  const hasAutoSizedColumnsRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [statusFilter, setStatusFilter] =
    useState<SalesWorkflowFilterValue>("open");
  const [searchValue, setSearchValue] = useState("");
  const [selectedOrders, setSelectedOrders] = useState<SalesOrderListRow[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [hasActiveSort, setHasActiveSort] = useState(false);
  const [activePanel, setActivePanel] = useState<SalesOrderPanelState | null>(
    null
  );
  const { data: orders = initialData } = useQuery({
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
  const gridRows = useMemo(
    () => displayedOrders.map(buildSalesOrderGridRow),
    [displayedOrders]
  );
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
  const activePanelOrder = useMemo(
    () =>
      activePanel
        ? displayedOrders.find((order) => order.id === activePanel.orderId) ?? null
        : null,
    [activePanel, displayedOrders]
  );
  const visibleActivePanel = activePanelOrder ? activePanel : null;
  const closeStatusPanel = useCallback(() => setActivePanel(null), []);
  const handleSearchChange = useCallback((value: string) => {
    setActivePanel(null);
    setSearchValue(value);
  }, []);
  const handleStatusFilterChange = useCallback((value: SalesWorkflowFilterValue) => {
    setActivePanel(null);
    setStatusFilter(value);
  }, []);
  const handleCellClicked = useCallback(
    (event: CellClickedEvent<SalesOrderGridRow>) => {
      const colId = event.column.getColId();
      if (!event.data || !STATUS_CELL_COLUMN_IDS.has(colId)) {
        return;
      }
      const kind = colId as SalesOrderPanelKind;
      if (!isStatusPanelActionable(event.data, kind)) {
        return;
      }

      const position = panelPosition(
        event.event instanceof MouseEvent ? event.event : undefined
      );
      setActivePanel({
        kind,
        orderId: event.data.id,
        ...position,
      });
    },
    []
  );
  const gridColumns = useMemo<ColDef<SalesOrderGridRow>[]>(
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
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderGridRow>) =>
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
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderGridRow>) =>
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
        valueGetter: ({ data }) => data?.__grid.notesLabel ?? "",
        tooltipValueGetter: ({ data }) =>
          data?.__grid.notesLabel === "—" ? "" : data?.__grid.notesLabel,
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
        width: 185,
        minWidth: 180,
        cellClass: ({ data }) => data?.__grid.salesItemsCellClass ?? ["statusBlockCell"],
        valueGetter: ({ data }) => data?.__grid.salesItemsLabel ?? "",
        valueFormatter: ({ value }) => String(value ?? ""),
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderGridRow>) =>
          data ? <StatusCell state={data.__grid.salesItemsState} /> : null,
        comparator: (_left, _right, leftNode, rightNode) =>
          parseQuantity(leftNode.data?.fulfillmentSummary.shortQty) -
          parseQuantity(rightNode.data?.fulfillmentSummary.shortQty),
      },
      {
        colId: "ingredientsState",
        headerName: "Ingredients",
        headerTooltip: SALES_ORDER_INGREDIENTS_STATUS_TOOLTIP,
        width: 185,
        minWidth: 180,
        cellClass: ({ data }) => data?.__grid.ingredientsCellClass ?? ["statusBlockCell"],
        valueGetter: ({ data }) => data?.__grid.ingredientsLabel ?? "",
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderGridRow>) =>
          data ? <StatusCell state={data.__grid.ingredientsState} /> : null,
      },
      {
        colId: "productionState",
        headerName: "Production",
        headerTooltip: SALES_ORDER_PRODUCTION_STATUS_TOOLTIP,
        width: 195,
        minWidth: 190,
        cellClass: ({ data }) => data?.__grid.productionCellClass ?? ["statusBlockCell"],
        valueGetter: ({ data }) => data?.__grid.productionLabel ?? "",
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderGridRow>) =>
          data ? <StatusCell state={data.__grid.productionState} /> : null,
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
        cellClass: ({ data }) => data?.__grid.deliveryCellClass ?? ["statusBlockCell"],
        valueGetter: ({ data }) => data?.__grid.deliveryLabel ?? "",
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderGridRow>) =>
          data ? <StatusCell state={data.__grid.deliveryState} /> : null,
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
        valueGetter: ({ data }) => data?.__grid.shipDate ?? null,
        valueFormatter: ({ data }) => data?.__grid.shipDateLabel ?? "—",
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
      <ERPDataGrid
        rows={gridRows}
        columns={gridColumns}
        searchInputRef={searchInputRef}
        searchAriaLabel="Search orders, customers, PO"
        searchValue={searchValue}
        onSearchChange={handleSearchChange}
        enableQuickFilter={false}
        emptyMessage="No sales orders yet."
        enableRowSelection
        hideHeaderSelectionCheckbox
        onSelectionChange={setSelectedOrders}
        onCellClicked={handleCellClicked}
        enableManagedRowDrag={reorderEnabled}
        suppressMoveWhenRowDragging
        relaxResizableMaxWidth
        toolbarContent={
          <WorkflowStatusFilter
            value={statusFilter}
            openCount={openCount}
            doneCount={doneCount}
            ariaLabel="Filter sales orders by workflow"
            onValueChange={handleStatusFilterChange}
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
        rowHeight={55}
      />
      <SalesOrderStatusPanel
        panel={visibleActivePanel}
        order={activePanelOrder}
        onClose={closeStatusPanel}
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
