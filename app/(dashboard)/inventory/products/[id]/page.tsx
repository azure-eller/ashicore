import { redirect } from "next/navigation";
import {
  getItem,
  getLots,
  getStockMovements,
  getBomComponents,
  getVariants,
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
  const item = await getItem(id);
  if (!item) redirect("/inventory/products");

  const canViewBom = item.bomLocked
    ? canViewLockedBom(context.assignedRoles)
    : canViewUnlockedBom(context.assignedRoles);
  const canEdit = item.bomLocked
    ? hasModuleAccess(context.assignedRoles, "inventory", "admin") &&
      canManageLockedBom(context.assignedRoles)
    : hasModuleAccess(context.assignedRoles, "inventory", "operate");

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
      />
    );
  }

  const [lots, movements, bom] = await Promise.all([
    getLots(id),
    getStockMovements(id),
    canViewBom ? getBomComponents(id) : Promise.resolve([]),
  ]);

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
