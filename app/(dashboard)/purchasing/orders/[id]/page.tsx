import { redirect } from "next/navigation";
import { PurchaseOrderDetail } from "@/app/(dashboard)/purchasing/purchase-order-detail";
import { getPurchaseOrder } from "@/app/(dashboard)/purchasing/queries";
import { hasModuleAccess } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await getAuthedMemberContext();
  const { id } = await params;
  const order = await getPurchaseOrder(id, { includeDeleted: true });

  if (!order) {
    redirect("/purchasing/orders");
  }

  return (
    <PurchaseOrderDetail
      order={order}
      canViewLedger={hasModuleAccess(context.assignedRoles, "inventory", "read")}
    />
  );
}
