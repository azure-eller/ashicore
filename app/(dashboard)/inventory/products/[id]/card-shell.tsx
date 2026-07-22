import { redirect } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import type { ReactNode } from "react";
import { getItem } from "@/lib/inventory/queries/item-detail";
import { getUnitDefinitions } from "@/lib/inventory/queries/units";
import { requireModuleReadAccess } from "@/lib/dal/auth";
import { hasModuleAccess } from "@/lib/authz";
import { getItemCard } from "@/lib/inventory/item-cards";
import { ProductCard, type ProductCardTab } from "./product-card";
import { getFeatureAccessForCurrentOrg } from "@/lib/billing/dal";

type ProductCardShellProps = {
  itemId: string;
  activeTab?: ProductCardTab;
  lotsCount?: number;
  children?: ReactNode;
};

export async function ProductCardShell({
  itemId,
  activeTab,
  lotsCount,
  children,
}: ProductCardShellProps) {
  noStore();
  const context = await requireModuleReadAccess("inventory");
  const item = await getItem(itemId);
  if (!item || item.itemType !== "product") {
    redirect("/inventory/products");
  }

  const card = await getItemCard(itemId);

  const [units, lotAccess] = await Promise.all([
    getUnitDefinitions(),
    getFeatureAccessForCurrentOrg("lot_tracking"),
  ]);

  return (
    <ProductCard
      initialItemId={itemId}
      initialCard={card}
      unitOptions={units.map((unit) => ({
        id: unit.id,
        name: unit.name,
        size: unit.size,
        uom: unit.uom,
      }))}
      activeTab={activeTab}
      lotsCount={lotsCount}
      canOperateInventory={hasModuleAccess(context.assignedRoles, "inventory", "operate")}
      canAdminInventory={hasModuleAccess(context.assignedRoles, "inventory", "admin")}
      lotTrackingLocked={lotAccess.locked}
    >
      {children}
    </ProductCard>
  );
}
