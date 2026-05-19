import { requireModuleAccess } from "@/lib/dal/auth";
import { getUnitDefinitions } from "@/app/(dashboard)/inventory/queries";
import type { ItemCardDto } from "@/lib/api/clients/item-cards";
import { ProductCard } from "../[id]/product-card";

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
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      deletedAt: null,
    },
    options: [],
    variants: [],
  };
}

export default async function NewProductPage() {
  await requireModuleAccess("inventory", "operate");
  const units = await getUnitDefinitions();
  const defaultUnit =
    units.find((unit) => unit.name.toLowerCase() === "each") ?? units[0];
  if (!defaultUnit) {
    const { getCategories, getAvailableComponents } = await import(
      "@/app/(dashboard)/inventory/queries"
    );
    const { getManufacturingResources } = await import(
      "@/lib/dal/manufacturing-resources"
    );
    const { ItemForm } = await import("@/app/(dashboard)/inventory/item-form");
    const { getAuthedMemberContext } = await import("@/lib/dal/auth");
    const { hasModuleAccess } = await import("@/lib/authz");
    const [context, categories, components, resources] = await Promise.all([
      getAuthedMemberContext(),
      getCategories(),
      getAvailableComponents(),
      getManufacturingResources(),
    ]);
    return (
      <ItemForm
        itemType="product"
        units={units}
        categories={categories}
        availableComponents={components}
        manufacturingResources={resources}
        canManageBomLock={hasModuleAccess(context.assignedRoles, "inventory", "admin")}
      />
    );
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
      initialBomRows={[]}
      availableComponents={[]}
      canViewBom={false}
    />
  );
}
