import type { SalesOrderListRow } from "../types";

export type SalesOrderLaneId =
  | "draft"
  | "supply_needed"
  | "in_production"
  | "ready_to_ship"
  | "shipped"
  | "cancelled";

export type SalesOrderSortMode = "shipDate" | "orderNumber" | "value";

export type SalesOrderLaneDefinition = {
  id: SalesOrderLaneId;
  title: string;
  subtitle: string;
  icon: "package" | "alert" | "factory" | "check" | "bag";
  accentClassName: string;
};

export const ACTIVE_LANE_DEFINITIONS: SalesOrderLaneDefinition[] = [
  {
    id: "draft",
    title: "Draft",
    subtitle: "Not yet live",
    icon: "package",
    accentClassName: "bg-muted-foreground/40",
  },
  {
    id: "supply_needed",
    title: "Supply Needed",
    subtitle: "Short stock or capacity",
    icon: "alert",
    accentClassName: "bg-warning",
  },
  {
    id: "in_production",
    title: "In Production",
    subtitle: "MO work is open",
    icon: "factory",
    accentClassName: "bg-primary",
  },
  {
    id: "ready_to_ship",
    title: "Ready to Ship",
    subtitle: "No open blockers",
    icon: "check",
    accentClassName: "bg-success",
  },
  {
    id: "shipped",
    title: "Shipped",
    subtitle: "Fulfilled orders",
    icon: "bag",
    accentClassName: "bg-info",
  },
];

export const CANCELLED_LANE_DEFINITION: SalesOrderLaneDefinition = {
  id: "cancelled",
  title: "Cancelled",
  subtitle: "Hidden by default",
  icon: "alert",
  accentClassName: "bg-destructive",
};

export const ALL_LANE_DEFINITIONS = [
  ...ACTIVE_LANE_DEFINITIONS,
  CANCELLED_LANE_DEFINITION,
] as const;

export const LANE_FILTER_OPTIONS: Array<{
  value: "all" | SalesOrderLaneId;
  label: string;
}> = [
  { value: "all", label: "All lanes" },
  { value: "draft", label: "Draft" },
  { value: "supply_needed", label: "Supply Needed" },
  { value: "in_production", label: "In Production" },
  { value: "ready_to_ship", label: "Ready to Ship" },
  { value: "shipped", label: "Shipped" },
  { value: "cancelled", label: "Cancelled" },
];

export function readSalesOrderNumber(value: string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toQuantityString(value: number) {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(4).replace(/\.?0+$/, "");
}

export function isActiveLiveSalesOrder(order: SalesOrderListRow) {
  return order.status === "confirmed" || order.status === "partially_shipped";
}

export function deriveSalesOrderLane(order: SalesOrderListRow): SalesOrderLaneId {
  if (order.status === "draft") return "draft";
  if (order.status === "cancelled") return "cancelled";
  if (order.status === "shipped") return "shipped";

  const shortQty = readSalesOrderNumber(order.fulfillmentSummary.shortQty);
  if (
    isActiveLiveSalesOrder(order) &&
    order.shippingReadiness.state === "ready" &&
    shortQty <= 0
  ) {
    return "ready_to_ship";
  }
  if (isActiveLiveSalesOrder(order) && order.openManufacturingOrderCount > 0) {
    return "in_production";
  }
  if (isActiveLiveSalesOrder(order) && shortQty > 0) {
    return "supply_needed";
  }

  return order.shippingReadiness.blockers.length === 0
    ? "ready_to_ship"
    : "supply_needed";
}

export function emptySalesOrderLaneGroups(): Record<
  SalesOrderLaneId,
  SalesOrderListRow[]
> {
  return {
    draft: [],
    supply_needed: [],
    in_production: [],
    ready_to_ship: [],
    shipped: [],
    cancelled: [],
  };
}

export function groupSalesOrdersByLane(orders: SalesOrderListRow[]) {
  const lanes = emptySalesOrderLaneGroups();
  orders.forEach((order) => {
    lanes[deriveSalesOrderLane(order)].push(order);
  });
  return lanes;
}

export function sortSalesOrdersForBoard(
  orders: SalesOrderListRow[],
  sortMode: SalesOrderSortMode
) {
  return orders.toSorted((left, right) => {
    if (sortMode === "value") {
      return (
        readSalesOrderNumber(right.totalAmount) -
        readSalesOrderNumber(left.totalAmount)
      );
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
}

export function getLaneBadgeLabel(order: SalesOrderListRow) {
  const lane = deriveSalesOrderLane(order);
  if (lane === "draft") return "Draft";
  if (lane === "supply_needed") return "Supply Needed";
  if (lane === "in_production") return "In Production";
  if (lane === "ready_to_ship") return "Ready";
  if (lane === "shipped") return "Shipped";
  return "Cancelled";
}

export function getLaneBadgeVariant(order: SalesOrderListRow) {
  const lane = deriveSalesOrderLane(order);
  if (lane === "ready_to_ship") return "success" as const;
  if (lane === "supply_needed") return "warning" as const;
  if (lane === "in_production") return "default" as const;
  if (lane === "cancelled") return "destructive" as const;
  return "secondary" as const;
}

export function progressPercent(allocated: number, remaining: number) {
  if (remaining <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((allocated / remaining) * 100)));
}
