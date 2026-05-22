import { requireModuleAccess } from "@/lib/dal/auth";
import { getManufacturingProductTemplates } from "@/app/(dashboard)/manufacturing/queries";
import { ManufacturingOrderCard } from "../orders/[id]/manufacturing-order-card";

/**
 * Draft MO entry point — mirrors `/inventory/product` (singular). The sheet
 * itself is the create surface: pick a product (planned qty defaults to 1)
 * and the order is created inline, then the URL swaps to
 * `/manufacturing/orders/{id}` for continued inline autosave editing.
 */
export default async function ManufacturingOrderDraftPage() {
  await requireModuleAccess("manufacturing", "operate");
  const templates = await getManufacturingProductTemplates();

  return (
    <ManufacturingOrderCard
      initialOrderId={null}
      initialOrder={null}
      productOptions={templates.map((template) => ({
        id: template.id,
        name: template.name,
        displayName: template.displayName,
        sku: template.sku,
        unitName: template.unitName,
        manufacturingMode: template.manufacturingMode,
        expectedBatchYield: template.expectedBatchYield,
        bom: template.bom.map((row) => ({
          itemId: row.itemId,
          quantityPerUnit: row.quantityPerUnit,
        })),
      }))}
    />
  );
}
