import { requireModuleAccess } from "@/lib/dal/auth";
import { hasModuleAccess } from "@/lib/authz";
import { getUnitDefinitions } from "@/lib/inventory/queries/units";
import { getSuppliers } from "@/lib/purchasing/queries/suppliers";
import type { ItemCardDto } from "@/lib/api/clients/item-cards";
import { MaterialCard } from "../materials/[id]/material-card";

function emptyCard(itemType: "material", unitDefinitionId: string): ItemCardDto {
  return {
    focusedVariantId: "",
    family: {
      id: "",
      itemType,
      name: "",
      category: null,
      description: null,
      unitDefinitionId,
      unitName: null,
      defaultSupplierId: null,
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      lotTrackingMode: "tracked",
      version: 0,
      deletedAt: null,
      createdAt: null,
      updatedAt: null,
    },
    options: [],
    variants: [],
  };
}

export default async function MaterialDraftPage() {
  const context = await requireModuleAccess("inventory", "operate");
  const [units, suppliers] = await Promise.all([
    getUnitDefinitions(),
    getSuppliers(),
  ]);
  const defaultUnit =
    units.find((unit) => unit.name.toLowerCase() === "each") ?? units[0];

  return (
    <MaterialCard
      initialItemId={null}
      initialCard={emptyCard("material", defaultUnit?.id ?? "")}
      usedInBoms={[]}
      unitOptions={units.map((unit) => ({
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
      initialLots={[]}
      canAdminInventory={hasModuleAccess(context.assignedRoles, "inventory", "admin")}
    />
  );
}
