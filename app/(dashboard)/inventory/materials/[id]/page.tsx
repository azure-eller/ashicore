import { redirect } from "next/navigation";
import {
  getLots,
  getUnitDefinitions,
  getUsedInParents,
} from "@/app/(dashboard)/inventory/queries";
import { getSuppliers } from "@/app/(dashboard)/purchasing/queries";
import { requireModuleReadAccess } from "@/lib/dal/auth";
import { hasModuleAccess } from "@/lib/authz";
import { getItemCard, ItemCardError } from "@/lib/inventory/item-cards";
import { MaterialCard } from "./material-card";

export default async function MaterialDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requireModuleReadAccess("inventory");
  const { id } = await params;
  const card = await getItemCard(id).catch((error: unknown) => {
    if (error instanceof ItemCardError && error.status === 404) {
      return null;
    }
    throw error;
  });

  if (!card) redirect("/inventory/materials");

  const [usedInParents, unitOptions, lots, suppliers] = await Promise.all([
    getUsedInParents(id),
    getUnitDefinitions(),
    getLots(id, { includeNegativeBalances: true }),
    getSuppliers(),
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
      canAdminInventory={hasModuleAccess(context.assignedRoles, "inventory", "admin")}
    />
  );
}
