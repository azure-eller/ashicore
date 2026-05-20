import { redirect } from "next/navigation";
import { PurchaseOrderForm } from "@/app/(dashboard)/purchasing/purchase-order-form";
import {
  getEditablePurchaseOrder,
  getPurchaseOrder,
  getPurchaseOrderMaterialOptions,
  getSuppliers,
} from "@/app/(dashboard)/purchasing/queries";
import { getAddressEntries } from "@/lib/dal/addresses";
import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { captureAppError } from "@/lib/observability/sentry";

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleWriteAccess("purchasing");
  const { id } = await params;
  let order;
  let detail;
  let suppliers;
  let materials;
  let addresses;

  try {
    [order, detail, suppliers, materials, addresses] = await Promise.all([
      getEditablePurchaseOrder(id),
      getPurchaseOrder(id, { includeDeleted: true }),
      getSuppliers(),
      getPurchaseOrderMaterialOptions(),
      getAddressEntries(),
    ]);
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
    <PurchaseOrderForm
      initialData={order}
      suppliers={suppliers.map((supplier) => ({
        id: supplier.id,
        name: supplier.name,
        code: supplier.code,
      }))}
      materials={materials}
      addresses={addresses}
      orderTitle={detail?.orderNumber}
    />
  );
}
