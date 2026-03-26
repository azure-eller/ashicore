import { redirect } from "next/navigation";
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
  const { id } = await params;
  const [order, supplierRows, materials] = await Promise.all([
    getEditablePurchaseOrder(id),
    getSuppliers(),
    getPurchaseOrderMaterialOptions(),
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
      />
    </div>
  );
}
