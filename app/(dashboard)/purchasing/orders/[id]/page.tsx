import { redirect } from "next/navigation";
import { PurchaseOrderDetail } from "@/app/(dashboard)/purchasing/purchase-order-detail";
import { getPurchaseOrder } from "@/app/(dashboard)/purchasing/queries";
import { hasModuleAccess } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { captureAppError } from "@/lib/observability/sentry";

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await getAuthedMemberContext();
  const { id } = await params;
  let order;

  try {
    order = await getPurchaseOrder(id, { includeDeleted: true });
  } catch (error) {
    captureAppError(error, {
      route: "/purchasing/orders/[id]",
      method: "GET",
      runtime: "server",
      module: "purchasing",
      operation: "render_purchase_order_detail",
      source: "server_component",
      appDebug: {
        has_purchase_order_id: Boolean(id),
      },
    });
    throw error;
  }

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
