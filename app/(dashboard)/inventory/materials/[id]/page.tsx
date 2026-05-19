import { redirect } from "next/navigation";
import {
  getItem,
  getItemCommitmentSummary,
  getLots,
  getStockMovements,
  getUsedInParents,
} from "@/app/(dashboard)/inventory/queries";
import {
  ItemDetail,
  normalizeItemDetailTab,
} from "@/app/(dashboard)/inventory/item-detail";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { hasModuleAccess } from "@/lib/authz";
import { getItemCard, ItemCardError } from "@/lib/inventory/item-cards";
import { MaterialCard } from "./material-card";

export default async function MaterialDetailPage({
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
  if (!item) redirect("/inventory/materials");

  if (view === "card") {
    const cardResult = await getItemCard(id).catch((error: unknown) => {
      if (error instanceof ItemCardError && error.status === 404) {
        return null;
      }
      throw error;
    });
    if (cardResult) {
      const usedInParents = await getUsedInParents(id);
      return (
        <MaterialCard
          initialItemId={id}
          initialCard={cardResult}
          usedInBoms={usedInParents}
        />
      );
    }
    // 404 from the card endpoint — fall through to legacy detail rendering.
  }

  const [lots, movements, usedInParents, commitmentSummary] = await Promise.all([
    getLots(id),
    getStockMovements(id),
    getUsedInParents(id),
    getItemCommitmentSummary(id),
  ]);

  return (
    <ItemDetail
      item={item}
      itemType="material"
      lots={lots}
      movements={movements}
      usedInParents={usedInParents}
      commitmentSummary={commitmentSummary}
      canEdit={hasModuleAccess(context.assignedRoles, "inventory", "operate")}
      canViewLedger={hasModuleAccess(context.assignedRoles, "inventory", "read")}
      activeTab={normalizeItemDetailTab(tab, "material")}
    />
  );
}
