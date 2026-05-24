import { redirect } from "next/navigation";
import { PurchaseOrderCard } from "@/app/(dashboard)/purchasing/purchase-order-card";
import {
  getEditablePurchaseOrder,
  getPurchaseOrderMaterialOptions,
  getSuppliers,
} from "@/app/(dashboard)/purchasing/queries";
import { getAddressEntries } from "@/lib/dal/addresses";
import { requireModuleReadAccess } from "@/lib/dal/auth";
import { hasModuleAccess } from "@/lib/authz";
import { captureAppError } from "@/lib/observability/sentry";

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requireModuleReadAccess("purchasing");
  const canWrite = hasModuleAccess(
    context.assignedRoles,
    "purchasing",
    "operate",
  );
  const canViewLedger = hasModuleAccess(
    context.assignedRoles,
    "inventory",
    "read",
  );
  const { id } = await params;
  let order;
  let suppliers;
  let materials;
  let addresses;

  try {
    [order, suppliers, materials, addresses] = await Promise.all([
      getEditablePurchaseOrder(id),
      getSuppliers(),
      getPurchaseOrderMaterialOptions(),
      getAddressEntries(),
    ]);
  } catch (error) {
    captureAppError(error, {
      route: "/purchasing/order/[id]",
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
    <PurchaseOrderCard
      initialData={order}
      suppliers={suppliers.map((supplier) => ({
        id: supplier.id,
        name: supplier.name,
        code: supplier.code,
      }))}
      materials={materials}
      addresses={addresses}
      orderTitle={order.orderNumber}
      canWrite={canWrite}
      canViewLedger={canViewLedger}
    />
  );
}
