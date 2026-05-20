import type { OperationalState } from "@/components/operational-state-cell";
import type {
  SalesOrderDetail,
  SalesOrderListRow,
} from "@/app/(dashboard)/sales/types";

export type OrderDisplayStatusLabel =
  | "DRAFT"
  | "OPEN"
  | "ALLOCATED"
  | "PARTIALLY SHIPPED"
  | "SHIPPED"
  | "CLOSED";

export type OrderDisplayStatusTone = "neutral" | "accent" | "warning" | "success";

export type OrderDisplayStatus = {
  label: OrderDisplayStatusLabel;
  tone: OrderDisplayStatusTone;
  dotShape: "square" | "circle";
};

type OrderForDisplayStatus = Pick<
  SalesOrderListRow | SalesOrderDetail,
  "status" | "shippingReadiness" | "lines"
>;

export function deriveOrderDisplayStatus(order: OrderForDisplayStatus): OrderDisplayStatus {
  if (order.status === "done") {
    return { label: "CLOSED", tone: "neutral", dotShape: "square" };
  }
  if (order.lines.length === 0) {
    return { label: "DRAFT", tone: "neutral", dotShape: "square" };
  }
  switch (order.shippingReadiness.state) {
    case "shipped":
      return { label: "SHIPPED", tone: "success", dotShape: "circle" };
    case "ready":
      return { label: "ALLOCATED", tone: "success", dotShape: "circle" };
    case "in_production":
    case "needs_manufacturing":
    case "insufficient_stock":
      return { label: "PARTIALLY SHIPPED", tone: "warning", dotShape: "square" };
    case "not_confirmed":
    default:
      return { label: "OPEN", tone: "accent", dotShape: "square" };
  }
}

export type AllocationFilterValue = "all" | "allocated" | "partial" | "not_allocated";

function parseQuantity(value: string | null | undefined) {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getSalesItemsState(order: SalesOrderListRow): OperationalState {
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

export function getAllocationFilterValue(order: SalesOrderListRow): AllocationFilterValue {
  const label = getSalesItemsState(order).label;
  if (label === "Complete" || label === "Allocated") return "allocated";
  if (label === "Partial") return "partial";
  return "not_allocated";
}
