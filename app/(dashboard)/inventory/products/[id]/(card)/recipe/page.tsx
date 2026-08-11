import { redirect } from "next/navigation";
import {
  getAvailableComponents,
  getBomComponents,
  getBomOperationCosts,
  getBomRevisionHistory,
} from "@/lib/inventory/queries/bom-read";
import { getItem } from "@/lib/inventory/queries/item-detail";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import {
  canManageLockedBom,
  canViewLockedBom,
  canViewUnlockedBom,
  hasModuleAccess,
} from "@/lib/authz";
import { getItemCard } from "@/lib/inventory/item-cards";
import { getFeatureAccessForCurrentOrg } from "@/lib/billing/dal";
import { ProductRecipeTab } from "../../tabs/recipe";

export default async function ProductRecipePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { variant } = await searchParams;
  const [context, item, card, batchAccess] = await Promise.all([
    getAuthedMemberContext(),
    getItem(id),
    getItemCard(id),
    getFeatureAccessForCurrentOrg("batch_production"),
  ]);

  if (!item || item.itemType !== "product") redirect("/inventory/products");
  const variantId = Array.isArray(variant) ? variant[0] : variant;
  const focusItemId =
    variantId &&
    card.variants.some(
      (cardVariant) => cardVariant.id === variantId && cardVariant.deletedAt == null,
    )
      ? variantId
      : id;
  const focusItem = focusItemId === id ? item : await getItem(focusItemId);
  if (!focusItem || focusItem.itemType !== "product") redirect("/inventory/products");

  const canViewBom = focusItem.bomLocked
    ? canViewLockedBom(context.assignedRoles)
    : canViewUnlockedBom(context.assignedRoles);
  const canEditProduct = focusItem.bomLocked
    ? hasModuleAccess(context.assignedRoles, "inventory", "admin") &&
      canManageLockedBom(context.assignedRoles)
    : hasModuleAccess(context.assignedRoles, "inventory", "operate");
  const bomRows = canViewBom ? await getBomComponents(focusItemId) : [];
  const [availableComponents, bomRevisions, operationCosts] =
    await Promise.all([
      getAvailableComponents(focusItemId, {
        estimatedUnitCostItemIds: canViewBom
          ? bomRows.map((row) => row.componentId)
          : [],
      }),
      canViewBom ? getBomRevisionHistory(focusItemId) : Promise.resolve([]),
      canViewBom ? getBomOperationCosts(focusItemId) : Promise.resolve([]),
    ]);
  const currentRevision = bomRevisions.find((revision) => revision.isCurrent);

  return (
    <ProductRecipeTab
      key={`${focusItemId}:${currentRevision?.id ?? "none"}`}
      focusItemId={focusItemId}
      initialBomRows={bomRows.map((row) => ({
        componentId: row.componentId,
        quantity: row.quantity,
        minimumLotAgeDays: row.minimumLotAgeDays ?? null,
        alternates: row.alternates.map((alternate) => ({
          itemId: alternate.itemId,
          quantity: alternate.quantity,
        })),
      }))}
      initialBomRevisionId={currentRevision?.id ?? null}
      initialOutputQuantity={currentRevision?.outputQuantity ?? "1"}
      initialRecipeBasis={currentRevision?.recipeBasis === "batch" ? "batch" : "unit"}
      initialExpectedBatchYield={focusItem.expectedBatchYield}
      bomRevisions={bomRevisions}
      availableComponents={availableComponents.map((component) => ({
        id: component.id,
        name: component.name,
        familyId: component.familyId,
        displayName: component.displayName,
        itemType: component.itemType,
        unit: component.unit,
        estimatedUnitCost: component.estimatedUnitCost,
      }))}
      hasOperationCosts={operationCosts.length > 0}
      canViewBom={canViewBom}
      canEditProduct={canEditProduct}
      batchProductionLocked={batchAccess.locked}
    />
  );
}
