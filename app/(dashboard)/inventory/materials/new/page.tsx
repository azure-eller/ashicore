import { getCategories, getUnitDefinitions } from "@/app/(dashboard)/inventory/queries";
import { ItemForm } from "@/app/(dashboard)/inventory/item-form";

export default async function NewMaterialPage() {
  const [units, categories] = await Promise.all([
    getUnitDefinitions(),
    getCategories(),
  ]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-3xl">
        <ItemForm itemType="material" units={units} categories={categories} />
      </div>
    </div>
  );
}
