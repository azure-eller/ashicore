import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { getCategories, getUnitDefinitions } from "@/app/(dashboard)/inventory/queries";
import { ItemForm } from "@/app/(dashboard)/inventory/item-form";

export default async function NewMaterialPage() {
  await requireModuleWriteAccess("inventory");
  const [units, categories] = await Promise.all([
    getUnitDefinitions(),
    getCategories(),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl py-8">
      <ItemForm itemType="material" units={units} categories={categories} />
    </div>
  );
}
