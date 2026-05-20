import { redirect } from "next/navigation";
import { getManufacturingOrder } from "@/app/(dashboard)/manufacturing/queries";
import { ManufacturingOrderCard } from "./manufacturing-order-card";

export async function ManufacturingOrderCardShell({ orderId }: { orderId: string }) {
  const order = await getManufacturingOrder(orderId);
  if (!order) {
    redirect("/manufacturing/orders");
  }
  return <ManufacturingOrderCard initialOrderId={orderId} initialOrder={order} />;
}
