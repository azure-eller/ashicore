"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  AlertCircleIcon,
  Calendar03Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  Factory01Icon,
  MoreVerticalIcon,
  NoteIcon,
  PackageIcon,
  PencilEdit02Icon,
  Search01Icon,
  ShoppingBag02Icon,
} from "@hugeicons/core-free-icons";
import { itemDetailHref } from "@/app/(dashboard)/inventory/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
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
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiJson } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { formatDate, formatPrice, formatQuantity } from "@/lib/format";
import { SalesOrderStatusBadge } from "./status-badge";
import { SoStageAction } from "./so-stage-action";
import { AllocationSheet } from "./allocation-sheet";
import { buildSalesOrderLineRemovalPayload } from "./order-line-removal";
import type {
  SalesOrderDetail,
  SalesOrderListRow,
} from "./types";

type BoardLaneId =
  | "draft"
  | "supply_needed"
  | "in_production"
  | "ready_to_ship"
  | "shipped"
  | "cancelled";

type DeleteTarget = {
  id: string;
  orderNumber: string;
} | null;

type DeleteLineActionPayload = {
  lineId: string;
  idempotencyKey: string;
};

type BoardLane = {
  id: BoardLaneId;
  title: string;
  subtitle: string;
  icon: typeof PackageIcon;
  accentClassName: string;
};

const BOARD_LANES: BoardLane[] = [
  {
    id: "draft",
    title: "Draft",
    subtitle: "Not yet live",
    icon: PackageIcon,
    accentClassName: "bg-muted-foreground/40",
  },
  {
    id: "supply_needed",
    title: "Supply Needed",
    subtitle: "Short stock or capacity",
    icon: AlertCircleIcon,
    accentClassName: "bg-warning",
  },
  {
    id: "in_production",
    title: "In Production",
    subtitle: "MO work is open",
    icon: Factory01Icon,
    accentClassName: "bg-primary",
  },
  {
    id: "ready_to_ship",
    title: "Ready to Ship",
    subtitle: "No open blockers",
    icon: CheckmarkCircle02Icon,
    accentClassName: "bg-success",
  },
  {
    id: "shipped",
    title: "Shipped",
    subtitle: "Fulfilled orders",
    icon: ShoppingBag02Icon,
    accentClassName: "bg-muted-foreground/45",
  },
];

const CANCELLED_LANE: BoardLane = {
  id: "cancelled",
  title: "Cancelled",
  subtitle: "Hidden by default",
  icon: AlertCircleIcon,
  accentClassName: "bg-destructive",
};

const LANE_FILTER_OPTIONS: Array<{ value: "all" | BoardLaneId; label: string }> = [
  { value: "all", label: "All lanes" },
  { value: "draft", label: "Draft" },
  { value: "supply_needed", label: "Supply Needed" },
  { value: "in_production", label: "In Production" },
  { value: "ready_to_ship", label: "Ready to Ship" },
  { value: "shipped", label: "Shipped" },
  { value: "cancelled", label: "Cancelled" },
];

function readNumber(value: string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toQuantityString(value: number) {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function isActiveLiveOrder(order: SalesOrderListRow) {
  return order.status === "confirmed" || order.status === "partially_shipped";
}

function deriveLane(order: SalesOrderListRow): BoardLaneId {
  if (order.status === "draft") return "draft";
  if (order.status === "cancelled") return "cancelled";
  if (order.status === "shipped") return "shipped";

  const shortQty = readNumber(order.fulfillmentSummary.shortQty);
  if (
    isActiveLiveOrder(order) &&
    order.shippingReadiness.state === "ready" &&
    shortQty <= 0
  ) {
    return "ready_to_ship";
  }
  if (isActiveLiveOrder(order) && order.openManufacturingOrderCount > 0) {
    return "in_production";
  }
  if (isActiveLiveOrder(order) && shortQty > 0) {
    return "supply_needed";
  }

  return order.shippingReadiness.blockers.length === 0 ? "ready_to_ship" : "supply_needed";
}

function orderMatchesSearch(order: SalesOrderListRow, search: string) {
  if (!search.trim()) return true;
  const needle = search.trim().toLowerCase();
  return [
    order.orderNumber,
    order.customerName,
    order.customerEmail ?? "",
    order.itemSummary,
    ...order.lines.flatMap((line) => [line.masterName, line.attrs.join(" ")]),
  ].some((value) => value.toLowerCase().includes(needle));
}

function getReadinessVariant(order: SalesOrderListRow) {
  const lane = deriveLane(order);
  if (lane === "ready_to_ship") return "success" as const;
  if (lane === "supply_needed") return "warning" as const;
  if (lane === "in_production") return "default" as const;
  if (lane === "cancelled") return "destructive" as const;
  return "secondary" as const;
}

function laneBadgeLabel(order: SalesOrderListRow) {
  const lane = deriveLane(order);
  if (lane === "draft") return "Draft";
  if (lane === "supply_needed") return "Supply Needed";
  if (lane === "in_production") return "In Production";
  if (lane === "ready_to_ship") return "Ready";
  if (lane === "shipped") return "Shipped";
  return "Cancelled";
}

function progressPercent(allocated: number, remaining: number) {
  if (remaining <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((allocated / remaining) * 100)));
}

function OrderNotesPreview({ notes }: { notes: string | null }) {
  const trimmedNotes = notes?.trim();

  if (!trimmedNotes) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex min-w-0 items-center gap-1 rounded-md border bg-background/70 px-1.5 py-1 text-xs text-muted-foreground">
          <HugeiconsIcon
            icon={NoteIcon}
            strokeWidth={2}
            className="size-3 shrink-0"
          />
          <span className="truncate">{trimmedNotes}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-80 whitespace-pre-wrap">
        {trimmedNotes}
      </TooltipContent>
    </Tooltip>
  );
}

function OrderMetricStrip({ orders }: { orders: SalesOrderListRow[] }) {
  const metrics = useMemo(() => {
    const visibleOrders = orders.filter((order) => order.status !== "cancelled");
    const totalValue = visibleOrders.reduce(
      (sum, order) => sum + readNumber(order.totalAmount),
      0
    );
    const laneCounts = visibleOrders.reduce(
      (acc, order) => {
        acc[deriveLane(order)] += 1;
        return acc;
      },
      {
        draft: 0,
        supply_needed: 0,
        in_production: 0,
        ready_to_ship: 0,
        shipped: 0,
        cancelled: 0,
      } satisfies Record<BoardLaneId, number>
    );

    return [
      {
        label: "Total Orders",
        value: visibleOrders.length.toString(),
        icon: PackageIcon,
        tone: "bg-primary/10 text-primary",
      },
      {
        label: "Total Value",
        value: formatPrice(toQuantityString(totalValue)) ?? "$0.00",
        icon: ShoppingBag02Icon,
        tone: "bg-success/10 text-success",
      },
      {
        label: "Supply Needed",
        value: laneCounts.supply_needed.toString(),
        icon: AlertCircleIcon,
        tone: "bg-warning/10 text-warning",
      },
      {
        label: "In Production",
        value: laneCounts.in_production.toString(),
        icon: Factory01Icon,
        tone: "bg-primary/10 text-primary",
      },
      {
        label: "Ready to Ship",
        value: laneCounts.ready_to_ship.toString(),
        icon: CheckmarkCircle02Icon,
        tone: "bg-success/10 text-success",
      },
    ];
  }, [orders]);

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {metrics.map((metric) => (
        <Card
          key={metric.label}
          size="sm"
          className="w-44 shrink-0 rounded-lg py-3 shadow-xs"
        >
          <CardContent className="flex items-center justify-between gap-3 px-3">
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-muted-foreground">
                {metric.label}
              </div>
              <div className="mt-1 text-xl font-semibold tracking-normal">
                {metric.value}
              </div>
            </div>
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg",
                metric.tone
              )}
            >
              <HugeiconsIcon icon={metric.icon} strokeWidth={2} className="size-4" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function SalesOrderToolbar({
  search,
  onSearchChange,
  laneFilter,
  onLaneFilterChange,
  customerFilter,
  onCustomerFilterChange,
  sortMode,
  onSortModeChange,
  showCancelled,
  onShowCancelledChange,
  customers,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  laneFilter: "all" | BoardLaneId;
  onLaneFilterChange: (value: "all" | BoardLaneId) => void;
  customerFilter: string;
  onCustomerFilterChange: (value: string) => void;
  sortMode: "shipDate" | "orderNumber" | "value";
  onSortModeChange: (value: "shipDate" | "orderNumber" | "value") => void;
  showCancelled: boolean;
  onShowCancelledChange: (value: boolean) => void;
  customers: string[];
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card/70 p-2.5 shadow-xs">
      <div className="flex min-w-0 flex-1 basis-full flex-wrap items-center gap-2 xl:basis-auto">
        <div className="relative min-w-0 basis-full sm:min-w-56 sm:flex-1 sm:max-w-sm">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search orders"
            placeholder="Search orders, customers, items..."
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            className="pl-8"
          />
        </div>
        <Select
          value={laneFilter}
          onValueChange={(value) => onLaneFilterChange(value as "all" | BoardLaneId)}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-40"
            aria-label="Filter by lane"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANE_FILTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={customerFilter} onValueChange={onCustomerFilterChange}>
          <SelectTrigger
            size="sm"
            className="w-full sm:w-44"
            aria-label="Filter by customer"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All customers</SelectItem>
            {customers.map((customer) => (
              <SelectItem key={customer} value={customer}>
                {customer}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={sortMode}
          onValueChange={(value) =>
            onSortModeChange(value as "shipDate" | "orderNumber" | "value")
          }
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-36"
            aria-label="Sort orders"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="shipDate">Ship date</SelectItem>
            <SelectItem value="orderNumber">Order number</SelectItem>
            <SelectItem value="value">Value</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex w-full items-center justify-start gap-2 sm:justify-end xl:w-auto">
        <Button
          type="button"
          variant={showCancelled ? "secondary" : "outline"}
          size="sm"
          onClick={() => onShowCancelledChange(!showCancelled)}
        >
          Cancelled
          {showCancelled ? (
            <Badge variant="outline" className="ml-1 h-4 px-1.5 text-[10px]">
              On
            </Badge>
          ) : null}
        </Button>
        <Separator orientation="vertical" className="hidden h-7 sm:block" />
        <Button asChild size="sm">
          <Link href="/sales/orders/new" prefetch={false}>
            <HugeiconsIcon
              icon={Add01Icon}
              strokeWidth={2}
              className="size-3.5"
              data-icon="inline-start"
            />
            New Order
          </Link>
        </Button>
      </div>
    </div>
  );
}

function SalesOrderLane({
  lane,
  orders,
  expandedOrderId,
  onToggleExpanded,
  onDelete,
}: {
  lane: BoardLane;
  orders: SalesOrderListRow[];
  expandedOrderId: string | null;
  onToggleExpanded: (orderId: string) => void;
  onDelete: (target: DeleteTarget) => void;
}) {
  return (
    <section className="flex h-[calc(100vh-20rem)] min-h-[32rem] max-h-[46rem] w-[19rem] shrink-0 flex-col rounded-xl bg-muted/15 p-2 ring-1 ring-border/35">
      <div className="mb-2 flex items-start justify-between gap-2 px-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", lane.accentClassName)} />
            <h2 className="truncate text-sm font-semibold">{lane.title}</h2>
            <Badge variant="secondary" className="h-5 px-1.5">
              {orders.length}
            </Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{lane.subtitle}</p>
        </div>
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground ring-1 ring-border/70">
          <HugeiconsIcon icon={lane.icon} strokeWidth={2} className="size-3.5" />
        </div>
      </div>
      <ScrollArea
        className="min-h-0 flex-1 overflow-hidden overscroll-contain"
        viewportClassName="pl-1 pr-3 pb-4"
      >
        <div className="flex flex-col gap-2">
          {orders.length ? (
            orders.map((order) => (
              <SalesOrderCard
                key={order.id}
                order={order}
                expanded={expandedOrderId === order.id}
                onToggleExpanded={() => onToggleExpanded(order.id)}
                onDelete={() =>
                  onDelete({ id: order.id, orderNumber: order.orderNumber })
                }
              />
            ))
          ) : (
            <div className="rounded-lg border border-dashed bg-background/50 px-3 py-6 text-center text-xs text-muted-foreground">
              No orders
            </div>
          )}
        </div>
      </ScrollArea>
    </section>
  );
}

function SalesOrderCard({
  order,
  expanded,
  onToggleExpanded,
  onDelete,
}: {
  order: SalesOrderListRow;
  expanded: boolean;
  onToggleExpanded: () => void;
  onDelete: () => void;
}) {
  const shortQty = readNumber(order.fulfillmentSummary.shortQty);
  const remainingQty = readNumber(order.fulfillmentSummary.remainingQty);
  const allocatedQty = readNumber(order.fulfillmentSummary.allocatedQty);
  const percent = progressPercent(allocatedQty, remainingQty);
  const lane = deriveLane(order);
  const canEdit = order.status === "draft";

  return (
    <Card
      size="sm"
      data-testid="sales-order-card"
      data-order-number={order.orderNumber}
      className={cn(
        "gap-0 overflow-hidden rounded-lg py-0 shadow-xs transition hover:shadow-md",
        expanded && "shadow-md ring-2 ring-inset ring-primary/50",
        lane === "supply_needed" && !expanded && "ring-warning/25",
        lane === "ready_to_ship" && !expanded && "ring-success/20"
      )}
    >
      <button
        type="button"
        onClick={onToggleExpanded}
        className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-expanded={expanded}
      >
        <CardHeader className="bg-card px-2.5 py-2.5">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md",
                    lane === "ready_to_ship" && "bg-success/10 text-success",
                    lane === "supply_needed" && "bg-warning/10 text-warning",
                    lane === "in_production" && "bg-primary/10 text-primary",
                    lane === "draft" && "bg-muted text-muted-foreground",
                    lane === "shipped" && "bg-muted text-muted-foreground",
                    lane === "cancelled" && "bg-destructive/10 text-destructive"
                  )}
                >
                  <HugeiconsIcon
                    icon={lane === "in_production" ? Factory01Icon : PackageIcon}
                    strokeWidth={2}
                    className="size-3"
                  />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold leading-tight">
                    {order.orderNumber}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {order.customerName}
                  </div>
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold">
                {formatPrice(order.totalAmount) ?? "\u2014"}
              </div>
              <div className="mt-1 flex justify-end">
                <Badge variant={getReadinessVariant(order)}>{laneBadgeLabel(order)}</Badge>
              </div>
            </div>
          </div>
        </CardHeader>
        <div className="mx-2.5 h-px bg-border" />
        <div className="flex flex-col gap-2 px-2.5 py-2.5">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span
              className={cn(
                "font-medium",
                shortQty > 0 ? "text-warning" : "text-muted-foreground"
              )}
            >
              {order.fulfillmentSummary.label}
            </span>
            <span className="shrink-0 text-muted-foreground">{percent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                shortQty > 0 ? "bg-warning" : "bg-success"
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <HugeiconsIcon icon={Calendar03Icon} strokeWidth={2} className="size-3" />
              Ship {order.shipDate ? formatDate(order.shipDate) : "\u2014"}
            </span>
            {shortQty > 0 ? (
              <span className="font-medium text-destructive">
                {formatQuantity(order.fulfillmentSummary.shortQty)} short
              </span>
            ) : null}
            {order.openManufacturingOrderCount > 0 ? (
              <span className="font-medium text-primary">
                {order.openManufacturingOrderCount} MO
              </span>
            ) : null}
          </div>
          <OrderNotesPreview notes={order.notes} />
          {!expanded ? (
            <div className="line-clamp-2 text-xs leading-snug text-muted-foreground">
              {order.itemSummary}
            </div>
          ) : null}
        </div>
      </button>
      {expanded ? (
        <CardContent className="px-2.5 pt-0 pb-2.5">
          <ExpandedOrderCard order={order} />
        </CardContent>
      ) : null}
      <CardFooter className="justify-between gap-2 border-t bg-card px-2.5 py-2">
        <div className="min-w-0">
          {order.status === "draft" ||
          (isActiveLiveOrder(order) &&
            order.hasManufacturableLines &&
            readNumber(order.fulfillmentSummary.shortQty) > 0) ? (
            <SoStageAction order={order} />
          ) : (
            <SalesOrderStatusBadge status={order.status} />
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="xs">
            <Link href={`/sales/orders/${order.id}`} prefetch={false}>
              Open
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`More actions for ${order.orderNumber}`}
              >
                <HugeiconsIcon icon={MoreVerticalIcon} strokeWidth={2} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="bg-popover text-popover-foreground"
            >
              <DropdownMenuItem asChild>
                <Link href={`/sales/orders/${order.id}`} prefetch={false}>
                  Open detail
                </Link>
              </DropdownMenuItem>
              {canEdit ? (
                <DropdownMenuItem asChild>
                  <Link href={`/sales/orders/${order.id}/edit`} prefetch={false}>
                    <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
                    Edit
                  </Link>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardFooter>
    </Card>
  );
}

function ExpandedOrderCard({ order }: { order: SalesOrderListRow }) {
  const [allocationLineId, setAllocationLineId] = useState<string | null>(null);
  const [lineToDelete, setLineToDelete] =
    useState<SalesOrderDetail["lines"][number] | null>(null);
  const [deleteLineIdempotencyKey, setDeleteLineIdempotencyKey] =
    useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["sales-order-detail", order.id],
    queryFn: async () =>
      apiJson<SalesOrderDetail>(`/api/sales-orders/${order.id}`, {
        fallbackError: "Failed to fetch order.",
      }),
    enabled: true,
  });

  const detail = data ?? null;
  const lines = detail?.lines ?? [];
  const canEdit =
    detail != null &&
    detail.deletedAt == null &&
    (detail.status === "draft" || detail.status === "confirmed");
  const canRemoveLines = canEdit && lines.length > 1;
  const shortQty = readNumber(order.fulfillmentSummary.shortQty);
  const allocatedQty = readNumber(order.fulfillmentSummary.allocatedQty);
  const remainingQty = readNumber(order.fulfillmentSummary.remainingQty);
  const percent = progressPercent(allocatedQty, remainingQty);
  const allocationOpen =
    detail != null &&
    ["draft", "confirmed", "partially_shipped"].includes(detail.status);
  const allocatableLines = allocationOpen
    ? lines.filter((line) => Number(line.remainingQuantity) > 0)
    : [];
  const deleteLineMutation = useMutation({
    mutationFn: async ({ lineId, idempotencyKey }: DeleteLineActionPayload) => {
      if (!detail) throw new Error("Order is still loading.");

      await apiJson<void>(`/api/sales-orders/${order.id}`, {
        method: "PUT",
        idempotencyKey,
        body: buildSalesOrderLineRemovalPayload(detail, lineId),
        fallbackError: "Failed to delete line.",
      });
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-order-detail", order.id] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      setLineToDelete(null);
      setDeleteLineIdempotencyKey(null);
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const openDeleteLineDialog = (line: SalesOrderDetail["lines"][number]) => {
    setLineToDelete(line);
    setDeleteLineIdempotencyKey(`sales-order-line-delete:${crypto.randomUUID()}`);
  };

  return (
    <div className="mt-2.5 space-y-2.5 rounded-lg border bg-background/80 p-2 shadow-xs">
      <AllocationSheet
        lineId={allocationLineId}
        open={allocationLineId != null}
        onOpenChange={(open) => {
          if (!open) setAllocationLineId(null);
        }}
        onTargetLineChange={setAllocationLineId}
      />
      <AlertDialog
        open={lineToDelete != null}
        onOpenChange={(open) => {
          if (!open) {
            setLineToDelete(null);
            setDeleteLineIdempotencyKey(null);
          }
        }}
      >
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this line?</AlertDialogTitle>
            <AlertDialogDescription>
              {lineToDelete
                ? `${lineToDelete.masterName} will be removed from this order.`
                : "This line will be removed from the order."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteLineMutation.isPending}
              onClick={() => {
                if (!lineToDelete || !deleteLineIdempotencyKey) return;
                deleteLineMutation.mutate({
                  lineId: lineToDelete.id,
                  idempotencyKey: deleteLineIdempotencyKey,
                });
              }}
            >
              {deleteLineMutation.isPending ? "Deleting..." : "Delete Line"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {actionError ? <p className="text-xs text-destructive">{actionError}</p> : null}
      {isLoading ? (
        <div className="flex min-h-28 items-center justify-center">
          <Spinner className="text-foreground" />
        </div>
      ) : isError ? (
        <p className="text-xs text-destructive">{error.message}</p>
      ) : detail ? (
        <>
          <LineItemsMiniTable
            order={detail}
            canEdit={canEdit}
            canRemoveLines={canRemoveLines}
            onDeleteLine={openDeleteLineDialog}
          />
          <SupplyBuckets order={detail} />
          <AllocationSlots percent={percent} />
          <FulfillmentProgress
            allocatedQty={allocatedQty}
            remainingQty={remainingQty}
            shortQty={shortQty}
            percent={percent}
          />
          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={allocatableLines.length === 0}
              onClick={() => {
                const firstLine = allocatableLines[0];
                if (firstLine) setAllocationLineId(firstLine.id);
              }}
            >
              <HugeiconsIcon
                icon={PackageIcon}
                strokeWidth={2}
                className="size-3"
                data-icon="inline-start"
              />
              Manage
            </Button>
            {detail.status === "draft" ? (
              <Button asChild type="button" variant="ghost" size="xs">
                <Link href={`/sales/orders/${order.id}/edit`} prefetch={false}>
                  Edit
                </Link>
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function LineItemsMiniTable({
  order,
  canEdit,
  canRemoveLines,
  onDeleteLine,
}: {
  order: SalesOrderDetail;
  canEdit: boolean;
  canRemoveLines: boolean;
  onDeleteLine: (line: SalesOrderDetail["lines"][number]) => void;
}) {
  const gridClassName = canEdit
    ? "grid-cols-[minmax(5rem,1fr)_2.35rem_2.35rem_2.35rem_3.25rem]"
    : "grid-cols-[minmax(5rem,1fr)_2.55rem_2.55rem_2.55rem]";

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
          Line Items
        </h3>
        <Badge variant="outline">{order.lines.length}</Badge>
      </div>
      <div className="overflow-hidden rounded-md border">
        <div
          className={cn(
            "grid gap-1 bg-muted/60 px-2 py-1.5 text-[10px] font-medium text-muted-foreground",
            gridClassName
          )}
        >
          <span>Item</span>
          <span className="text-right">Demand</span>
          <span className="text-right">Alloc.</span>
          <span className="text-right">Short</span>
          {canEdit ? <span className="text-right">Act.</span> : null}
        </div>
        {order.lines.map((line) => {
          const short = readNumber(line.shortQty);

          return (
            <div
              key={line.id}
              data-testid="sales-order-line-row"
              data-line-name={line.masterName}
              className={cn(
                "grid items-center gap-1 border-t px-2 py-1.5 text-xs",
                gridClassName
              )}
            >
              <div className="min-w-0">
                <Link
                  href={itemDetailHref("product", line.itemId)}
                  className="block truncate font-medium leading-tight hover:underline"
                >
                  {line.masterName}
                </Link>
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {line.attrs.length ? line.attrs.join(" · ") : line.unitName}
                </div>
              </div>
              <span className="text-right">{formatQuantity(line.quantity)}</span>
              <span className="text-right">{formatQuantity(line.allocatedQty)}</span>
              <span
                className={cn(
                  "text-right font-medium",
                  short > 0 ? "text-destructive" : "text-muted-foreground"
                )}
              >
                {short > 0 ? formatQuantity(line.shortQty) : "\u2014"}
              </span>
              {canEdit ? (
                <span className="flex justify-end gap-0.5">
                  <Button asChild variant="ghost" size="icon-xs">
                    <Link
                      href={`/sales/orders/${order.id}/edit`}
                      prefetch={false}
                      aria-label={`Edit ${line.masterName}`}
                    >
                      <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Delete ${line.masterName}`}
                    disabled={!canRemoveLines}
                    onClick={() => onDeleteLine(line)}
                  >
                    <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                  </Button>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SupplyBuckets({ order }: { order: SalesOrderDetail }) {
  const buckets = useMemo(() => {
    const production = new Map<string, { label: string; quantity: number; status: string }>();
    let stockQuantity = 0;
    let stockAvailable = 0;

    order.lines.forEach((line) => {
      stockAvailable += readNumber(line.availableQty);
      line.allocationSources.forEach((source) => {
        if (source.sourceType === "stock_pool") {
          stockQuantity += readNumber(source.quantity);
          return;
        }

        const existing = production.get(source.label) ?? {
          label: source.label,
          quantity: 0,
          status: source.coverageKind === "explicit" ? "Reserved" : "Avail",
        };
        existing.quantity += readNumber(source.quantity);
        production.set(source.label, existing);
      });
    });

    return [
      {
        key: "stock",
        label: "Stock",
        quantity: stockQuantity,
        sublabel: stockAvailable > 0 ? "Avail" : "Free",
        icon: PackageIcon,
        tone: stockQuantity > 0 ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
      },
      ...[...production.values()].map((source, index) => ({
        key: source.label,
        label: source.label,
        quantity: source.quantity,
        sublabel: source.status,
        icon: Factory01Icon,
        tone:
          index % 2 === 0
            ? "bg-primary/10 text-primary"
            : "bg-warning/10 text-warning",
      })),
    ].slice(0, 4);
  }, [order.lines]);

  const visibleBuckets = [
    ...buckets,
    ...[
      {
        key: "production-placeholder",
        label: "MO Supply",
        quantity: 0,
        sublabel: "Avail",
        icon: Factory01Icon,
        tone: "bg-muted text-muted-foreground",
      },
      {
        key: "make-to-order-placeholder",
        label: "MTO",
        quantity: 0,
        sublabel: "Avail",
        icon: Factory01Icon,
        tone: "bg-muted text-muted-foreground",
      },
    ].slice(0, Math.max(0, 3 - buckets.length)),
  ].slice(0, 4);

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-normal text-muted-foreground">
        Supply Buckets
      </h3>
      <div className="grid grid-cols-3 gap-1.5">
        {visibleBuckets.map((bucket) => (
          <div
            key={bucket.key}
            className="rounded-md border bg-card p-2 shadow-xs"
          >
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded",
                  bucket.tone
                )}
              >
                <HugeiconsIcon
                  icon={bucket.icon}
                  strokeWidth={2}
                  className="size-3"
                />
              </span>
              <span className="min-w-0 truncate text-[11px] font-medium">
                {bucket.label}
              </span>
            </div>
            <div className="mt-2 text-lg font-semibold leading-none">
              {formatQuantity(toQuantityString(bucket.quantity))}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {bucket.sublabel}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AllocationSlots({ percent }: { percent: number }) {
  const filledSlots = Math.round((percent / 100) * 10);

  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Allocation slots</span>
        <span>Open manager to adjust</span>
      </div>
      <div className="grid grid-cols-10 gap-1">
        {Array.from({ length: 10 }).map((_, index) => (
          <div
            key={index}
            className={cn(
              "h-5 rounded border border-dashed bg-muted/40",
              index < filledSlots && "border-primary/25 bg-primary/10"
            )}
            aria-hidden
          />
        ))}
      </div>
    </section>
  );
}

function FulfillmentProgress({
  allocatedQty,
  remainingQty,
  shortQty,
  percent,
}: {
  allocatedQty: number;
  remainingQty: number;
  shortQty: number;
  percent: number;
}) {
  return (
    <section className="rounded-md bg-muted/45 p-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">
          {formatQuantity(toQuantityString(allocatedQty))} /{" "}
          {formatQuantity(toQuantityString(remainingQty))} units allocated
        </span>
        <span className="text-muted-foreground">{percent}%</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background">
        <div
          className={cn(
            "h-full rounded-full",
            shortQty > 0 ? "bg-warning" : "bg-success"
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Available now: {formatQuantity(toQuantityString(allocatedQty))}</span>
        <span
          className={cn(shortQty > 0 && "font-medium text-destructive")}
        >
          Remaining short: {formatQuantity(toQuantityString(shortQty))}
        </span>
      </div>
    </section>
  );
}

export function OrdersTable({ initialData }: { initialData: SalesOrderListRow[] }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [laneFilter, setLaneFilter] = useState<"all" | BoardLaneId>("all");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [sortMode, setSortMode] = useState<"shipDate" | "orderNumber" | "value">(
    "shipDate"
  );
  const [showCancelled, setShowCancelled] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: orders = initialData } = useQuery<SalesOrderListRow[]>({
    queryKey: ["sales-orders"],
    queryFn: () =>
      apiJson<SalesOrderListRow[]>("/api/sales-orders", {
        fallbackError: "Failed to fetch orders.",
      }),
    initialData,
  });

  const customers = useMemo(
    () => [...new Set(orders.map((order) => order.customerName))].toSorted(),
    [orders]
  );
  const includeCancelled = showCancelled || laneFilter === "cancelled";

  const filteredOrders = useMemo(() => {
    return orders
      .filter((order) => includeCancelled || order.status !== "cancelled")
      .filter((order) => laneFilter === "all" || deriveLane(order) === laneFilter)
      .filter((order) => customerFilter === "all" || order.customerName === customerFilter)
      .filter((order) => orderMatchesSearch(order, search))
      .toSorted((left, right) => {
        if (sortMode === "value") {
          return readNumber(right.totalAmount) - readNumber(left.totalAmount);
        }
        if (sortMode === "orderNumber") {
          return left.orderNumber.localeCompare(right.orderNumber, undefined, {
            numeric: true,
          });
        }

        const dateCompare = (left.shipDate ?? "9999-12-31").localeCompare(
          right.shipDate ?? "9999-12-31"
        );
        if (dateCompare !== 0) return dateCompare;
        return left.orderNumber.localeCompare(right.orderNumber, undefined, {
          numeric: true,
        });
      });
  }, [customerFilter, includeCancelled, laneFilter, orders, search, sortMode]);

  const visibleLanes = useMemo(() => {
    const lanes = includeCancelled ? [...BOARD_LANES, CANCELLED_LANE] : BOARD_LANES;
    return laneFilter === "all"
      ? lanes
      : lanes.filter((lane) => lane.id === laneFilter);
  }, [includeCancelled, laneFilter]);

  const ordersByLane = useMemo(() => {
    const lanes: Record<BoardLaneId, SalesOrderListRow[]> = {
      draft: [],
      supply_needed: [],
      in_production: [],
      ready_to_ship: [],
      shipped: [],
      cancelled: [],
    };

    filteredOrders.forEach((order) => {
      lanes[deriveLane(order)].push(order);
    });

    return lanes;
  }, [filteredOrders]);

  const deleteMutation = useMutation({
    mutationFn: async (target: NonNullable<DeleteTarget>) => {
      await apiJson<void>("/api/sales-orders", {
        method: "DELETE",
        idempotencyKey: "sales-orders-delete",
        body: { ids: [target.id] },
        fallbackError: "Failed to delete order.",
      });
    },
    onMutate: () => {
      setFormError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      setDeleteTarget(null);
    },
    onError: (error) => {
      setFormError(error.message);
    },
  });

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Sales Orders</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Kanban + Queue Control Room
            </p>
          </div>
          <div className="text-sm text-muted-foreground">
            Showing {filteredOrders.length} of {orders.length} orders
          </div>
        </div>

        <OrderMetricStrip orders={orders} />

        <SalesOrderToolbar
          search={search}
          onSearchChange={setSearch}
          laneFilter={laneFilter}
          onLaneFilterChange={setLaneFilter}
          customerFilter={customerFilter}
          onCustomerFilterChange={setCustomerFilter}
          sortMode={sortMode}
          onSortModeChange={setSortMode}
          showCancelled={showCancelled}
          onShowCancelledChange={setShowCancelled}
          customers={customers}
        />

        {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
        {filteredOrders.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            {search ? `No results for "${search}"` : "No orders match the current filters."}
          </div>
        ) : null}

        <ScrollArea
          className="-mx-4 overflow-hidden pb-3"
          viewportClassName="px-4 pb-3"
        >
          <div className="flex min-w-max gap-3">
            {visibleLanes.map((lane) => (
              <SalesOrderLane
                key={lane.id}
                lane={lane}
                orders={ordersByLane[lane.id]}
                expandedOrderId={expandedOrderId}
                onToggleExpanded={(orderId) =>
                  setExpandedOrderId((current) =>
                    current === orderId ? null : orderId
                  )
                }
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>

      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.orderNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              This order will be soft-deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending || deleteTarget == null}
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget);
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
