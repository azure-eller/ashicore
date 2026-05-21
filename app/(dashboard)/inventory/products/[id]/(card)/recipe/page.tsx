import { redirect } from "next/navigation";
import {
  getAvailableComponents,
  getBomComponents,
  getBomRevisionHistory,
  getItem,
} from "@/app/(dashboard)/inventory/queries";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import {
  canManageLockedBom,
  canViewLockedBom,
  canViewUnlockedBom,
  hasModuleAccess,
} from "@/lib/authz";
import { getItemCard } from "@/lib/inventory/item-cards";
import { ProductRecipeTab } from "../../tabs/recipe";

export default async function ProductRecipePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [context, item, card] = await Promise.all([
    getAuthedMemberContext(),
    getItem(id),
    getItemCard(id),
  ]);

  if (!item || item.itemType !== "product") redirect("/inventory/products");

  const canViewBom = item.bomLocked
    ? canViewLockedBom(context.assignedRoles)
    : canViewUnlockedBom(context.assignedRoles);
  const canEditProduct = item.bomLocked
    ? hasModuleAccess(context.assignedRoles, "inventory", "admin") &&
      canManageLockedBom(context.assignedRoles)
    : hasModuleAccess(context.assignedRoles, "inventory", "operate");
  const [bomRows, availableComponents, bomRevisions] = await Promise.all([
    canViewBom ? getBomComponents(id) : Promise.resolve([]),
    getAvailableComponents(id),
    canViewBom ? getBomRevisionHistory(id) : Promise.resolve([]),
  ]);
  const currentRevision = bomRevisions.find((revision) => revision.isCurrent);

  return (
    <ProductRecipeTab
      card={card}
      focusItemId={id}
      initialBomRows={bomRows.map((row) => ({
        componentId: row.componentId,
        quantity: row.quantity,
        everyQuantity: row.everyQuantity ?? row.basisOutputQuantity ?? null,
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
      initialOutputQuantity={currentRevision?.outputQuantity ?? "1"}
      availableComponents={availableComponents.map((component) => ({
        id: component.id,
        name: component.name,
        displayName: component.displayName,
        itemType: component.itemType,
        unit: component.unit,
      }))}
      canViewBom={canViewBom}
      canEditProduct={canEditProduct}
    />
  );
}
