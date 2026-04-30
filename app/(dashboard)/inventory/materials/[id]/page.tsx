import { redirect } from "next/navigation";
import {
  getItem,
  getItemCommitmentSummary,
  getLots,
  getStockMovements,
  getUsedInParents,
} from "@/app/(dashboard)/inventory/queries";
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
  const item = await getItem(id);
  if (!item) redirect("/inventory/materials");

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
    />
  );
}
