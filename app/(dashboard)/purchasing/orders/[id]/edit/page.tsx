import { redirect } from "next/navigation";
import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { getAddressEntries } from "@/lib/dal/addresses";
import { PurchaseOrderForm } from "@/app/(dashboard)/purchasing/purchase-order-form";
import {
  getEditablePurchaseOrder,
  getPurchaseOrderMaterialOptions,
  getSuppliers,
} from "@/app/(dashboard)/purchasing/queries";

export default async function EditPurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleWriteAccess("purchasing");
  const { id } = await params;
  const [order, supplierRows, materials, addresses] = await Promise.all([
    getEditablePurchaseOrder(id),
    getSuppliers(),
    getPurchaseOrderMaterialOptions(),
    getAddressEntries(),
  ]);

  if (!order) {
    redirect("/purchasing/orders");
  }

  return (
    <div className="mx-auto w-full max-w-5xl py-8">
      <PurchaseOrderForm
        initialData={order}
        suppliers={supplierRows.map((supplier) => ({
          id: supplier.id,
          name: supplier.name,
          code: supplier.code,
        }))}
        materials={materials}
        addresses={addresses}
      />
    </div>
  );
}
