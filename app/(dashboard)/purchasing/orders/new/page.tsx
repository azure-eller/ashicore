import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { PurchaseOrderForm } from "@/app/(dashboard)/purchasing/purchase-order-form";
import {
  getPurchaseOrderMaterialOptions,
  getSuppliers,
} from "@/app/(dashboard)/purchasing/queries";

export default async function NewPurchaseOrderPage() {
  await requireModuleWriteAccess("purchasing");
  const [supplierRows, materials] = await Promise.all([
    getSuppliers(),
    getPurchaseOrderMaterialOptions(),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl py-8">
      <PurchaseOrderForm
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
