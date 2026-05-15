import { Suspense } from "react";
import { OrdersTable } from "@/app/(dashboard)/purchasing/orders-table";
import { getPurchaseOrders } from "@/app/(dashboard)/purchasing/queries";
import { captureAppError } from "@/lib/observability/sentry";
import OrdersTableLoading from "../orders-table-loading";

export default function PurchaseOrdersPage() {
  return (
    <Suspense fallback={<OrdersTableLoading />}>
      <PurchaseOrdersData />
    </Suspense>
  );
}

async function PurchaseOrdersData() {
  let orders;

  try {
    orders = await getPurchaseOrders();
  } catch (error) {
    captureAppError(error, {
      route: "/purchasing/orders",
      method: "GET",
      runtime: "server",
      module: "purchasing",
      operation: "render_purchase_orders_list",
      source: "server_component",
    });
    throw error;
  }

  return <OrdersTable initialData={orders} />;
}
