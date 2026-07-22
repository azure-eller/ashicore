import { redirect } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import { getLots } from "@/lib/inventory/queries/item-lots";
import { getUnitDefinitions } from "@/lib/inventory/queries/units";
import { getUsedInParents } from "@/lib/inventory/queries/bom-read";
import { getSuppliers } from "@/lib/purchasing/queries/suppliers";
import { requireModuleReadAccess } from "@/lib/dal/auth";
import { hasModuleAccess } from "@/lib/authz";
import { getItemCard, ItemCardError } from "@/lib/inventory/item-cards";
import { getFeatureAccessForCurrentOrg } from "@/lib/billing/dal";
import { MaterialCard } from "./material-card";

export const dynamic = "force-dynamic";

export default async function MaterialDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  noStore();
  const context = await requireModuleReadAccess("inventory");
  const { id } = await params;
  const card = await getItemCard(id).catch((error: unknown) => {
    if (error instanceof ItemCardError && error.status === 404) {
      return null;
    }
    throw error;
  });

  if (!card) redirect("/inventory/materials");

  const [usedInParents, unitOptions, lots, suppliers, lotAccess] = await Promise.all([
    getUsedInParents(id),
    getUnitDefinitions(),
    getLots(id, { includeNegativeBalances: true }),
    getSuppliers(),
    getFeatureAccessForCurrentOrg("lot_tracking"),
  ]);

  return (
    <MaterialCard
      initialItemId={id}
      initialCard={card}
      usedInBoms={usedInParents}
      unitOptions={unitOptions.map((unit) => ({
        id: unit.id,
        name: unit.name,
        size: unit.size,
        uom: unit.uom,
      }))}
      supplierOptions={suppliers.map((supplier) => ({
        id: supplier.id,
        name: supplier.name,
        code: supplier.code,
      }))}
      initialLots={lots}
      canOperateInventory={hasModuleAccess(context.assignedRoles, "inventory", "operate")}
      canAdminInventory={hasModuleAccess(context.assignedRoles, "inventory", "admin")}
      lotTrackingLocked={lotAccess.locked}
    />
  );
}
