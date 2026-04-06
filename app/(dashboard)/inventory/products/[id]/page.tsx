import { redirect } from "next/navigation";
import {
  getItem,
  getLots,
  getStockMovements,
  getBomComponents,
} from "@/app/(dashboard)/inventory/queries";
import { ItemDetail } from "@/app/(dashboard)/inventory/item-detail";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { canManageLockedBom, canViewLockedBom, canViewUnlockedBom, hasModuleAccess } from "@/lib/authz";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await getAuthedMemberContext();
  const { id } = await params;
  const [item, lots, movements] = await Promise.all([
    getItem(id),
    getLots(id),
    getStockMovements(id),
  ]);
  if (!item) redirect("/inventory/products");

  const canViewBom = item.bomLocked
    ? canViewLockedBom(context.assignedRoles)
    : canViewUnlockedBom(context.assignedRoles);
  const canEdit = item.bomLocked
    ? hasModuleAccess(context.assignedRoles, "inventory", "admin") &&
      canManageLockedBom(context.assignedRoles)
    : hasModuleAccess(context.assignedRoles, "inventory", "operate");
  const bom = canViewBom ? await getBomComponents(id) : [];

  return (
    <ItemDetail
      item={item}
      itemType="product"
      bom={canViewBom ? bom : undefined}
      lots={lots}
      movements={movements}
      canEdit={canEdit}
      canViewBom={canViewBom}
    />
  );
}
