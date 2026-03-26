import { redirect } from "next/navigation";
import { ManufacturingOrderDetail } from "@/app/(dashboard)/manufacturing/manufacturing-order-detail";
import { getManufacturingOrder } from "@/app/(dashboard)/manufacturing/queries";

export default async function ManufacturingOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await getManufacturingOrder(id);

  if (!order) {
    redirect("/manufacturing/orders");
  }

  return <ManufacturingOrderDetail order={order} />;
}
