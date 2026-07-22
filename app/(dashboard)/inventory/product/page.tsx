import { requireModuleAccess } from "@/lib/dal/auth";
import { hasModuleAccess } from "@/lib/authz";
import { getUnitDefinitionsForItemDraft } from "@/lib/inventory/queries/units";
import type { ItemCardDto } from "@/lib/api/clients/item-cards";
import { getFeatureAccessForCurrentOrg } from "@/lib/billing/dal";
import { ProductCard } from "../products/[id]/product-card";

function emptyCard(itemType: "product", unitDefinitionId: string): ItemCardDto {
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

export default async function ProductDraftPage() {
  const context = await requireModuleAccess("inventory", "operate");
  const [units, lotAccess] = await Promise.all([
    getUnitDefinitionsForItemDraft(),
    getFeatureAccessForCurrentOrg("lot_tracking"),
  ]);
  const defaultUnit =
    units.find((unit) => unit.name.toLowerCase() === "each") ?? units[0];
  if (!defaultUnit) throw new Error("Unable to prepare a default inventory unit.");

  return (
    <ProductCard
      initialItemId={null}
      initialCard={emptyCard("product", defaultUnit?.id ?? "")}
      unitOptions={units.map((unit) => ({
        id: unit.id,
        name: unit.name,
        size: unit.size,
        uom: unit.uom,
      }))}
      canOperateInventory
      canAdminInventory={hasModuleAccess(context.assignedRoles, "inventory", "admin")}
      lotTrackingLocked={lotAccess.locked}
    />
  );
}
