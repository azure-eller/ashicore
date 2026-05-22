import { Suspense } from "react";
import { OrdersTable } from "@/app/(dashboard)/sales/orders-table";
import { getSalesOrders } from "@/app/(dashboard)/sales/queries";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import OrdersTableLoading from "../orders-table-loading";

export default function OrdersPage() {
  return (
    <Suspense fallback={<OrdersTableLoading />}>
      <SalesOrdersData />
    </Suspense>
  );
}

async function SalesOrdersData() {
  const [orders, context] = await Promise.all([
    getSalesOrders(),
    getAuthedMemberContext(),
  ]);
  return (
    <OrdersTable
      initialData={orders}
      allocationMode={context.allocationMode}
    />
  );
}
