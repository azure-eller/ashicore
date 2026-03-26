import { OrdersTable } from "@/app/(dashboard)/manufacturing/orders-table";
import { getManufacturingOrders } from "@/app/(dashboard)/manufacturing/queries";

export default async function ManufacturingOrdersPage() {
  const orders = await getManufacturingOrders();
  return <OrdersTable initialData={orders} />;
}
