import { requireModuleWriteAccess } from "@/lib/dal/auth";
import {
  getCategories,
  getUnitDefinitions,
  getAvailableComponents,
} from "@/app/(dashboard)/inventory/queries";
import { ItemForm } from "@/app/(dashboard)/inventory/item-form";

export default async function NewProductPage() {
  await requireModuleWriteAccess("inventory");
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
      />
    </div>
  );
}
