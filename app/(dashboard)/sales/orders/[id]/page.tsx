import { redirect } from "next/navigation";
import { OrderDetail } from "@/app/(dashboard)/sales/order-detail";
import { getSalesOrder } from "@/app/(dashboard)/sales/queries";
import { hasModuleAccess } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await getAuthedMemberContext();
  const { id } = await params;
  const order = await getSalesOrder(id, { includeDeleted: true });

  if (!order) {
    redirect("/sales/orders");
  }

  return (
    <OrderDetail
      order={order}
      canViewLedger={hasModuleAccess(context.assignedRoles, "inventory", "read")}
    />
  );
}
