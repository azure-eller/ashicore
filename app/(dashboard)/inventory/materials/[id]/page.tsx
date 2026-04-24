import { redirect } from "next/navigation";
import { getItem, getLots, getStockMovements, getUsedInParents } from "@/app/(dashboard)/inventory/queries";
import { ItemDetail } from "@/app/(dashboard)/inventory/item-detail";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { hasModuleAccess } from "@/lib/authz";

export default async function MaterialDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await getAuthedMemberContext();
  const { id } = await params;
  const [item, lots, movements, usedInParents] = await Promise.all([
    getItem(id),
    getLots(id),
    getStockMovements(id),
    getUsedInParents(id),
  ]);
  if (!item) redirect("/inventory/materials");

  return (
    <ItemDetail
      item={item}
      itemType="material"
      lots={lots}
      movements={movements}
      usedInParents={usedInParents}
      canEdit={hasModuleAccess(context.assignedRoles, "inventory", "operate")}
      canViewLedger={hasModuleAccess(context.assignedRoles, "inventory", "operate")}
    />
  );
}
