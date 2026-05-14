import { Suspense } from "react";
import { OrdersTable } from "@/app/(dashboard)/sales/orders-table";
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
  return <OrdersTable initialData={orders} />;
}
