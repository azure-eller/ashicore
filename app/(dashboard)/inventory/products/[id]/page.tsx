import { redirect } from "next/navigation";
import {
  getItem,
  getLots,
  getStockMovements,
  getBomComponents,
  getItemCommitmentSummary,
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

  // Card view (Katana-style) is opt-in via ?view=card while Codex's backend
  // stabilizes. Flip to default once the DTO is exercised on Paonia data.
  if (view === "card") {
    const card = await getItemCard(id).catch((error: unknown) => {
      if (error instanceof ItemCardError && error.status === 404) {
        return null;
      }
      throw error;
    });
    if (card) {
      // Unit options are passed in as empty for v1 (Unit of measure is shown
      // read-only); plumb through later when the unit-change flow lands.
      return (
        <ProductCard initialItemId={id} initialCard={card} unitOptions={[]} />
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
