import { Suspense } from "react";
import { OrdersTable } from "@/app/(dashboard)/manufacturing/orders-table";
import { getManufacturingOrders } from "@/app/(dashboard)/manufacturing/queries";
import DataTableLoading from "../data-table-loading";

export default function ManufacturingOrdersPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Manufacturing Orders</h1>
      <Suspense fallback={<DataTableLoading />}>
        <ManufacturingOrdersData />
      </Suspense>
    </div>
  );
}

async function ManufacturingOrdersData() {
  const orders = await getManufacturingOrders();
  return <OrdersTable initialData={orders} />;
}
