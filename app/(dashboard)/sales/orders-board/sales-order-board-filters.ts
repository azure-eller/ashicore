import type { SalesOrderListRow } from "../types";
import {
  deriveSalesOrderLane,
  sortSalesOrdersForBoard,
  type SalesOrderLaneId,
  type SalesOrderSortMode,
} from "./sales-order-lane-model";

export type SalesOrderBoardFilters = {
  search: string;
  laneFilter: "all" | SalesOrderLaneId;
  customerFilter: string;
  showCancelled: boolean;
  sortMode: SalesOrderSortMode;
};

export function orderMatchesSearch(order: SalesOrderListRow, search: string) {
  if (!search.trim()) return true;
  const needle = search.trim().toLowerCase();
  return [
    order.orderNumber,
    order.customerName,
    order.customerEmail ?? "",
    order.itemSummary,
    order.notes ?? "",
    ...order.lines.flatMap((line) => [line.masterName, line.attrs.join(" ")]),
    ...order.shipments.map((shipment) => shipment.shipmentNumber),
  ].some((value) => value.toLowerCase().includes(needle));
}

export function filterOrdersForBoard(
  orders: SalesOrderListRow[],
  filters: SalesOrderBoardFilters
) {
  const includeCancelled =
    filters.showCancelled || filters.laneFilter === "cancelled";

  return sortSalesOrdersForBoard(
    orders
      .filter((order) => includeCancelled || order.status !== "cancelled")
      .filter(
        (order) =>
          filters.laneFilter === "all" ||
          deriveSalesOrderLane(order) === filters.laneFilter
      )
      .filter(
        (order) =>
          filters.customerFilter === "all" ||
          order.customerName === filters.customerFilter
      )
      .filter((order) => orderMatchesSearch(order, filters.search)),
    filters.sortMode
  );
}

export function getCustomerOptions(orders: SalesOrderListRow[]) {
  return [...new Set(orders.map((order) => order.customerName))].toSorted();
}
