import type { OperationalState } from "@/components/operational-state-cell";
import type {
  SalesOrderDetail,
  SalesOrderListRow,
} from "@/app/(dashboard)/sales/types";

export type OrderDisplayStatusLabel =
  | "NOT SHIPPED"
  | "PARTIALLY SHIPPED"
  | "SHIPPED";

export type OrderDisplayStatusTone = "neutral" | "accent" | "warning" | "success";

export type OrderDisplayStatus = {
  label: OrderDisplayStatusLabel;
  tone: OrderDisplayStatusTone;
  dotShape: "square" | "circle";
};

type OrderForDisplayStatus = Pick<
  SalesOrderListRow | SalesOrderDetail,
  "status" | "lines"
>;

function shippedSalesQuantity(order: OrderForDisplayStatus) {
  return order.lines.reduce(
    (sum, line) => sum + parseQuantity(line.shippedQuantity),
    0
  );
}

function orderedSalesQuantity(order: OrderForDisplayStatus) {
  return order.lines.reduce(
    (sum, line) => sum + parseQuantity(line.quantity),
    0
  );
}

export function deriveOrderDisplayStatus(order: OrderForDisplayStatus): OrderDisplayStatus {
  const shippedQty = shippedSalesQuantity(order);
  const orderedQty = orderedSalesQuantity(order);

  if (order.status === "done" || (orderedQty > 0 && shippedQty >= orderedQty)) {
    return { label: "SHIPPED", tone: "success", dotShape: "circle" };
  }
  if (shippedQty > 0) {
    return { label: "PARTIALLY SHIPPED", tone: "warning", dotShape: "square" };
  }
  return { label: "NOT SHIPPED", tone: "neutral", dotShape: "square" };
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
