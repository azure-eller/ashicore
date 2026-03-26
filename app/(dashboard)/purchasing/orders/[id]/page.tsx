import { redirect } from "next/navigation";
import { PurchaseOrderDetail } from "@/app/(dashboard)/purchasing/purchase-order-detail";
import { getPurchaseOrder } from "@/app/(dashboard)/purchasing/queries";

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await getPurchaseOrder(id, { includeDeleted: true });

  if (!order) {
    redirect("/purchasing/orders");
  }

  return <PurchaseOrderDetail order={order} />;
}
