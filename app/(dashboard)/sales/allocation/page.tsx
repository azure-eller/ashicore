import { Suspense } from "react";
import { getSalesOrders } from "@/app/(dashboard)/sales/queries";
import { SalesAllocationTable } from "@/app/(dashboard)/sales/sales-allocation-table";
import OrdersTableLoading from "../orders-table-loading";

export default function SalesAllocationPage() {
  return (
    <Suspense fallback={<OrdersTableLoading />}>
      <SalesAllocationData />
    </Suspense>
  );
}

async function SalesAllocationData() {
  const orders = await getSalesOrders();
  return <SalesAllocationTable initialData={orders} />;
}
