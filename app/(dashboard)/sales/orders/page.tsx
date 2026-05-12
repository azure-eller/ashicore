import { Suspense } from "react";
import { SalesOrdersBoard } from "@/app/(dashboard)/sales/orders-board/sales-orders-board";
import { getSalesOrders } from "@/app/(dashboard)/sales/queries";
import OrdersTableLoading from "../orders-table-loading";

export default function OrdersPage() {
  return (
    <Suspense fallback={<OrdersTableLoading />}>
      <SalesOrdersData />
    </Suspense>
  );
}

async function SalesOrdersData() {
  const orders = await getSalesOrders();
  return <SalesOrdersBoard initialData={orders} />;
}
