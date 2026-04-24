import { redirect } from "next/navigation";
import { ManufacturingOrderDetail } from "@/app/(dashboard)/manufacturing/manufacturing-order-detail";
import { getManufacturingOrder } from "@/app/(dashboard)/manufacturing/queries";
import { hasModuleAccess } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";

export default async function ManufacturingOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await getAuthedMemberContext();
  const { id } = await params;
  const order = await getManufacturingOrder(id);

  if (!order) {
    redirect("/manufacturing/orders");
  }

  return (
    <ManufacturingOrderDetail
      order={order}
      canViewLedger={hasModuleAccess(context.assignedRoles, "inventory", "read")}
    />
  );
}
