import { OrdersTable } from "@/app/(dashboard)/sales/orders-table";
import { getSalesOrders } from "@/app/(dashboard)/sales/queries";

export default async function OrdersPage() {
  const orders = await getSalesOrders();
  return <OrdersTable initialData={orders} />;
}
