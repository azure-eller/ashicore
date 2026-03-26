import { OrdersTable } from "@/app/(dashboard)/purchasing/orders-table";
import { getPurchaseOrders } from "@/app/(dashboard)/purchasing/queries";

export default async function PurchaseOrdersPage() {
  const orders = await getPurchaseOrders();
  return <OrdersTable initialData={orders} />;
}
