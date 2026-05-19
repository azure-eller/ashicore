import { redirect } from "next/navigation";
import {
  getAvailableComponents,
  getItem,
  getLots,
  getBomComponents,
  getUnitDefinitions,
} from "@/app/(dashboard)/inventory/queries";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { canViewLockedBom, canViewUnlockedBom } from "@/lib/authz";
import { getItemCard } from "@/lib/inventory/item-cards";
import { ProductCard } from "./product-card";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await getAuthedMemberContext();
  const { id } = await params;
  const item = await getItem(id);
  if (!item) redirect("/inventory/products");

  const card = await getItemCard(id);
  const canViewBom = item.bomLocked
    ? canViewLockedBom(context.assignedRoles)
    : canViewUnlockedBom(context.assignedRoles);
  const [unitOptions, bomRows, availableComponents, lots] = await Promise.all([
    getUnitDefinitions(),
    canViewBom ? getBomComponents(id) : Promise.resolve([]),
    getAvailableComponents(id),
    getLots(id),
  ]);

  return (
    <ProductCard
      initialItemId={id}
      initialCard={card}
      unitOptions={unitOptions.map((unit) => ({
        id: unit.id,
        name: unit.name,
        size: unit.size,
        uom: unit.uom,
      }))}
      initialBomRows={bomRows.map((row) => ({
        componentId: row.componentId,
        quantity: row.quantity,
        consumptionMode:
          (row.consumptionMode as
            | "per_output_unit"
            | "per_batch"
            | "per_group"
            | null) ?? null,
        basisOutputQuantity: row.basisOutputQuantity ?? null,
        batchScalingMode:
          (row.batchScalingMode as
            | "proportional"
            | "full_batches_only"
            | null) ?? null,
        groupRemainderPolicy:
          (row.groupRemainderPolicy as
            | "ask"
            | "leave_loose"
            | "create_partial_group"
            | null) ?? null,
        minimumLotAgeDays: row.minimumLotAgeDays ?? null,
        alternates: row.alternates.map((alternate) => ({
          itemId: alternate.itemId,
        })),
      }))}
      availableComponents={availableComponents.map((component) => ({
        id: component.id,
        name: component.name,
        displayName: component.displayName,
        itemType: component.itemType,
        unit: component.unit,
      }))}
      canViewBom={canViewBom}
      initialLots={lots}
    />
  );
}
