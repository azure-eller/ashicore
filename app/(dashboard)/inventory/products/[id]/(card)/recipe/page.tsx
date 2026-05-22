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
      key={`${id}:${currentRevision?.id ?? "none"}`}
      card={card}
      focusItemId={id}
      initialBomRows={bomRows.map((row) => ({
        componentId: row.componentId,
        quantity: row.quantity,
        minimumLotAgeDays: row.minimumLotAgeDays ?? null,
        alternates: row.alternates.map((alternate) => ({
          itemId: alternate.itemId,
        })),
      }))}
      initialBomRevisionId={currentRevision?.id ?? null}
      initialOutputQuantity={currentRevision?.outputQuantity ?? "1"}
      initialRecipeBasis={currentRevision?.recipeBasis === "batch" ? "batch" : "unit"}
      initialExpectedBatchYield={item.expectedBatchYield}
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
