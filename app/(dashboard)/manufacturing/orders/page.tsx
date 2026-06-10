import { Suspense } from "react";
import { OrdersTable } from "@/app/(dashboard)/manufacturing/orders-table";
import { getManufacturingOrders } from "@/lib/manufacturing/queries/orders-read";
import DataTableLoading from "../data-table-loading";

export default function ManufacturingOrdersPage() {
  return (
    <Suspense fallback={<DataTableLoading />}>
      <ManufacturingOrdersData />
    </Suspense>
  );
}

async function ManufacturingOrdersData() {
  const orders = await getManufacturingOrders();
  return <OrdersTable initialData={orders} />;
}
