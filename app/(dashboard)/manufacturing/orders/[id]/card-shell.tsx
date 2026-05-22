import { redirect } from "next/navigation";
import {
  getManufacturingOrder,
  getManufacturingProductTemplates,
} from "@/app/(dashboard)/manufacturing/queries";
import { ManufacturingOrderCard } from "./manufacturing-order-card";

export async function ManufacturingOrderCardShell({ orderId }: { orderId: string }) {
  const [order, templates] = await Promise.all([
    getManufacturingOrder(orderId),
    getManufacturingProductTemplates(),
  ]);
  if (!order) {
    redirect("/manufacturing/orders");
  }
  return (
    <ManufacturingOrderCard
      initialOrderId={orderId}
      initialOrder={order}
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
