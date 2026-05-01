import { Suspense } from "react";
import { OrdersTable } from "@/app/(dashboard)/purchasing/orders-table";
import { getPurchaseOrders } from "@/app/(dashboard)/purchasing/queries";
import OrdersTableLoading from "../orders-table-loading";

export default function PurchaseOrdersPage() {
  return (
    <Suspense fallback={<OrdersTableLoading />}>
      <PurchaseOrdersData />
    </Suspense>
  );
}

async function PurchaseOrdersData() {
  const orders = await getPurchaseOrders();
  return <OrdersTable initialData={orders} />;
}
