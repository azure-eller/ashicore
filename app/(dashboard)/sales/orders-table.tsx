"use client";

import { SalesOrdersBoard } from "./orders-board/sales-orders-board";
import type { SalesOrderListRow } from "./types";

export { SalesOrdersBoard };

export function OrdersTable({ initialData }: { initialData: SalesOrderListRow[] }) {
  return <SalesOrdersBoard initialData={initialData} />;
}
