import { requireModuleAccess } from "@/lib/dal/auth";
import { getUnitDefinitions } from "@/app/(dashboard)/inventory/queries";
import { NewCardPage } from "@/components/card-page/new-card-page";

export default async function NewProductPage() {
  await requireModuleAccess("inventory", "operate");
  const units = await getUnitDefinitions();
  const defaultUnit =
    units.find((unit) => unit.name.toLowerCase() === "each") ?? units[0];
  if (!defaultUnit) {
    // No units in the org yet — fall back to the legacy form so the user can
    // create one before adding products. Rare in practice (Paonia seed sets
    // up Each on every org).
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
    <NewCardPage
      itemType="product"
      defaultUnitId={defaultUnit.id}
      unitOptions={units.map((unit) => ({
        id: unit.id,
        name: unit.name,
        size: unit.size,
        uom: unit.uom,
      }))}
    />
  );
}
