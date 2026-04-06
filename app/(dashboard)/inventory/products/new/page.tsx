import { getAuthedMemberContext, requireModuleAccess } from "@/lib/dal/auth";
import {
  getCategories,
  getUnitDefinitions,
  getAvailableComponents,
} from "@/app/(dashboard)/inventory/queries";
import { ItemForm } from "@/app/(dashboard)/inventory/item-form";
import { hasModuleAccess } from "@/lib/authz";

export default async function NewProductPage() {
  await requireModuleAccess("inventory", "operate");
  const context = await getAuthedMemberContext();
  const [units, categories, components] = await Promise.all([
    getUnitDefinitions(),
    getCategories(),
    getAvailableComponents(),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl py-8">
      <ItemForm
        itemType="product"
        units={units}
        categories={categories}
        availableComponents={components}
        canManageBomLock={hasModuleAccess(context.assignedRoles, "inventory", "admin")}
      />
    </div>
  );
}
