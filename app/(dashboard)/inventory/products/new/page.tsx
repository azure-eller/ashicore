import {
  getCategories,
  getUnitDefinitions,
  getAvailableComponents,
} from "@/app/(dashboard)/inventory/queries";
import { ItemForm } from "@/app/(dashboard)/inventory/item-form";

export default async function NewProductPage() {
  const [units, categories, components] = await Promise.all([
    getUnitDefinitions(),
    getCategories(),
    getAvailableComponents(),
  ]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-3xl">
        <ItemForm
          itemType="product"
          units={units}
          categories={categories}
          availableComponents={components}
        />
      </div>
    </div>
  );
}
