import { getAuthedMemberContext, requireModuleAccess } from "@/lib/dal/auth";
import {
  getCategories,
  getUnitDefinitions,
  getAvailableComponents,
} from "@/app/(dashboard)/inventory/queries";
import { ItemForm } from "@/app/(dashboard)/inventory/item-form";
import { hasModuleAccess } from "@/lib/authz";
import { getManufacturingResources } from "@/lib/dal/manufacturing-resources";

export default async function NewProductPage() {
  await requireModuleAccess("inventory", "operate");
  const context = await getAuthedMemberContext();
  const [units, categories, components, resources] = await Promise.all([
    getUnitDefinitions(),
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
