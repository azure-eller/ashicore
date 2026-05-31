import type {
  SalesOrderDetail,
  SalesOrderListRow,
} from "@/app/(dashboard)/sales/types";
import {
  getSalesItemsDisplayState,
  type FulfillmentDisplayState,
} from "@/lib/sales/fulfillment-status";
import { parseQuantity } from "@/lib/format";

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

export type SalesAllocationMode = "manual" | "demand_queue";

export type SalesItemsFilterValue =
  | "all"
  | "allocated"
  | "partial"
  | "not_allocated"
  | "available"
  | "expected"
  | "not_available";

export function getSalesItemsState(
  order: SalesOrderListRow,
  mode: SalesAllocationMode = "manual"
): FulfillmentDisplayState {
  if (order.status === "done") {
    return { label: "Complete", tone: "success" };
  }

  const remainingQty = parseQuantity(order.fulfillmentSummary.remainingQty);

  if (remainingQty <= 0) {
    return { label: "Complete", tone: "success" };
  }

  if (mode === "manual") {
    const allocatedQty = parseQuantity(order.fulfillmentSummary.allocatedQty);
    const shortQty = parseQuantity(order.fulfillmentSummary.shortQty);

    if (shortQty <= 0) {
      return { label: "Allocated", tone: "success" };
    }
    if (allocatedQty > 0) {
      return { label: "Partial", tone: "warning" };
    }
    return { label: "Not allocated", tone: "destructive" };
  }

  return getSalesItemsDisplayState(
    order.fulfillmentSummary.salesItemsState,
    order.fulfillmentSummary.salesItemsExpectedDate
  );
}

export function getSalesItemsAvailabilityState(
  order: SalesOrderListRow
): FulfillmentDisplayState {
  if (order.status === "done") {
    return { label: "Complete", tone: "success" };
  }

  return getSalesItemsDisplayState(
    order.fulfillmentSummary.salesItemsState,
    order.fulfillmentSummary.salesItemsExpectedDate
  );
}

export function getSalesItemsFilterValue(
  order: SalesOrderListRow,
  mode: SalesAllocationMode = "manual"
): SalesItemsFilterValue {
  if (order.status === "done") {
    return mode === "manual" ? "allocated" : "available";
  }

  if (mode === "manual") {
    const label = getSalesItemsState(order, mode).label;
    if (label === "Complete" || label === "Allocated") return "allocated";
    if (label === "Partial") return "partial";
    return "not_allocated";
  }

  switch (order.fulfillmentSummary.salesItemsState) {
    case "complete":
    case "available":
      return "available";
    case "expected":
      return "expected";
    case "not_available":
    default:
      return "not_available";
  }
}
