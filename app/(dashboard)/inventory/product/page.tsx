import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/dal/auth";
import { hasModuleAccess } from "@/lib/authz";
import { getUnitDefinitions } from "@/lib/inventory/queries/units";
import type { ItemCardDto } from "@/lib/api/clients/item-cards";
import { ProductCard } from "../products/[id]/product-card";

function emptyCard(itemType: "product", unitDefinitionId: string): ItemCardDto {
  return {
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
      deletedAt: null,
      createdAt: null,
      updatedAt: null,
    },
    options: [],
    variants: [],
  };
}

export default async function ProductDraftPage() {
  const context = await requireModuleAccess("inventory", "operate");
  const units = await getUnitDefinitions();
  const defaultUnit =
    units.find((unit) => unit.name.toLowerCase() === "each") ?? units[0];
  if (!defaultUnit) {
    redirect("/inventory/products");
  }

  return (
    <ProductCard
      initialItemId={null}
      initialCard={emptyCard("product", defaultUnit.id)}
      unitOptions={units.map((unit) => ({
        id: unit.id,
        name: unit.name,
        size: unit.size,
        uom: unit.uom,
      }))}
      canAdminInventory={hasModuleAccess(context.assignedRoles, "inventory", "admin")}
    />
  );
}
