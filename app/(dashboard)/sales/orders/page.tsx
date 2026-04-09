import { Suspense } from "react";
import { OrdersTable } from "@/app/(dashboard)/sales/orders-table";
import { getSalesOrders } from "@/app/(dashboard)/sales/queries";
import OrdersTableSkeleton from "../orders-table-skeleton";

export default function OrdersPage() {
  return (
    <Suspense fallback={<OrdersTableSkeleton />}>
      <SalesOrdersData />
    </Suspense>
  );
}

async function SalesOrdersData() {
  const orders = await getSalesOrders();
  return <OrdersTable initialData={orders} />;
}
