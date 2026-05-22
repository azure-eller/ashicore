import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { PurchaseOrderCard } from "@/app/(dashboard)/purchasing/purchase-order-card";
import { purchaseOrderDefaultValues } from "@/lib/schemas/purchase-orders";
import { getAddressEntries } from "@/lib/dal/addresses";
import {
  getPurchaseOrderMaterialOptions,
  getSuppliers,
} from "@/app/(dashboard)/purchasing/queries";

function getValues(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

export default async function PurchaseOrderDraftPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModuleWriteAccess("purchasing");
  const params = await searchParams;
  const [supplierRows, materials, addresses] = await Promise.all([
    getSuppliers(),
    getPurchaseOrderMaterialOptions(),
    getAddressEntries(),
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
      accountingPurchaseAccountCode: material.accountingPurchaseAccountCode,
      shipAddressEntryId: null,
      shipContactName: null,
      shipContactPhone: null,
      shipLine1: null,
      shipLine2: null,
      shipCity: null,
      shipRegion: null,
      shipPostcode: null,
      shipCountry: null,
      shipDeliveryInstructions: null,
    }));
  const supplierId =
    typeof params.supplierId === "string" &&
    supplierRows.some((supplier) => supplier.id === params.supplierId)
      ? params.supplierId
      : "";
  const defaultValues =
    prefilledLines.length > 0 || supplierId
      ? {
          ...purchaseOrderDefaultValues,
          supplierId,
          lines: prefilledLines.length > 0
            ? prefilledLines
            : purchaseOrderDefaultValues.lines,
        }
      : undefined;

  return (
    <PurchaseOrderCard
      suppliers={supplierRows.map((supplier) => ({
        id: supplier.id,
        name: supplier.name,
        code: supplier.code,
      }))}
      materials={materials}
      addresses={addresses}
      defaultValues={defaultValues}
    />
  );
}
