import { Suspense } from "react";
import { OrdersTable } from "@/app/(dashboard)/manufacturing/orders-table";
import { getManufacturingOrders } from "@/app/(dashboard)/manufacturing/queries";
import DataTableSkeleton from "../data-table-skeleton";

export default function ManufacturingOrdersPage() {
  return (
    <Suspense fallback={<DataTableSkeleton />}>
      <ManufacturingOrdersData />
    </Suspense>
  );
}

async function ManufacturingOrdersData() {
  const orders = await getManufacturingOrders();
  return <OrdersTable initialData={orders} />;
}
