import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { PurchaseOrderForm } from "@/app/(dashboard)/purchasing/purchase-order-form";
import { purchaseOrderDefaultValues } from "@/lib/schemas/purchase-orders";
import {
  getPurchaseOrderMaterialOptions,
  getSuppliers,
} from "@/app/(dashboard)/purchasing/queries";

function getValues(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

export default async function NewPurchaseOrderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModuleWriteAccess("purchasing");
  const params = await searchParams;
  const [supplierRows, materials] = await Promise.all([
    getSuppliers(),
    getPurchaseOrderMaterialOptions(),
  ]);
  const materialIds = [...new Set(getValues(params.itemId))];
  const materialById = new Map(materials.map((material) => [material.id, material]));
  const prefilledLines = materialIds
    .map((id) => materialById.get(id))
    .filter((material): material is NonNullable<typeof material> => Boolean(material))
    .map((material) => ({
      itemId: material.id,
      quantityOrdered: null,
      unitCost: material.defaultPurchasePrice,
    }));
  const supplierId =
    typeof params.supplierId === "string" &&
    supplierRows.some((supplier) => supplier.id === params.supplierId)
      ? params.supplierId
      : "";
  const defaultValues =
    prefilledLines.length > 0
      ? {
          ...purchaseOrderDefaultValues,
          supplierId,
          lines: prefilledLines,
        }
      : undefined;

  return (
    <div className="mx-auto w-full max-w-5xl py-8">
      <PurchaseOrderForm
        suppliers={supplierRows.map((supplier) => ({
          id: supplier.id,
          name: supplier.name,
          code: supplier.code,
        }))}
        materials={materials}
        defaultValues={defaultValues}
      />
    </div>
  );
}
