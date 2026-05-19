import { redirect } from "next/navigation";
import {
  getAvailableComponents,
  getItem,
  getLots,
  getStockMovements,
  getBomComponents,
  getItemCommitmentSummary,
  getUnitDefinitions,
  getUsedInParents,
  getVariants,
} from "@/app/(dashboard)/inventory/queries";
import {
  ItemDetail,
  normalizeItemDetailTab,
} from "@/app/(dashboard)/inventory/item-detail";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { canManageLockedBom, canViewLockedBom, canViewUnlockedBom, hasModuleAccess } from "@/lib/authz";
import { getItemCard, ItemCardError } from "@/lib/inventory/item-cards";
import { ProductCard } from "./product-card";

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getAuthedMemberContext();
  const { id } = await params;
  const { tab, view } = await searchParams;
  const item = await getItem(id);
  if (!item) redirect("/inventory/products");

  if (view !== "legacy") {
    const card = await getItemCard(id).catch((error: unknown) => {
      if (error instanceof ItemCardError && error.status === 404) {
        return null;
      }
      throw error;
    });
    if (card) {
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
    // 404 from the card endpoint — fall through to legacy detail rendering.
  }

  const canViewBom = item.bomLocked
    ? canViewLockedBom(context.assignedRoles)
    : canViewUnlockedBom(context.assignedRoles);
  const canEdit = item.bomLocked
    ? hasModuleAccess(context.assignedRoles, "inventory", "admin") &&
      canManageLockedBom(context.assignedRoles)
    : hasModuleAccess(context.assignedRoles, "inventory", "operate");
  const canViewLedger = hasModuleAccess(context.assignedRoles, "inventory", "read");

  if (item.isMaster) {
    const variants = await getVariants(id);
    return (
      <ItemDetail
        item={item}
        itemType="product"
        lots={[]}
        movements={[]}
        variants={variants}
        canEdit={canEdit}
        canViewBom={false}
        canViewLedger={canViewLedger}
        activeTab={normalizeItemDetailTab(tab, "product")}
      />
    );
  }

  const [lots, movements, bom, usedInParents, commitmentSummary] = await Promise.all([
    getLots(id),
    getStockMovements(id),
    canViewBom ? getBomComponents(id) : Promise.resolve([]),
    getUsedInParents(id),
    getItemCommitmentSummary(id),
  ]);

  return (
    <ItemDetail
      item={item}
      itemType="product"
      bom={canViewBom ? bom : undefined}
      lots={lots}
      movements={movements}
      usedInParents={usedInParents}
      commitmentSummary={commitmentSummary}
      canEdit={canEdit}
      canViewBom={canViewBom}
      canViewLedger={canViewLedger}
      activeTab={normalizeItemDetailTab(tab, "product")}
    />
  );
}
