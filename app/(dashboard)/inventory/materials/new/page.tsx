import { requireModuleAccess } from "@/lib/dal/auth";
import { getCategories, getUnitDefinitions } from "@/app/(dashboard)/inventory/queries";
import { ItemForm } from "@/app/(dashboard)/inventory/item-form";

export default async function NewMaterialPage() {
  await requireModuleAccess("inventory", "operate");
  const [units, categories] = await Promise.all([
    getUnitDefinitions(),
    getCategories(),
  ]);

  return <ItemForm itemType="material" units={units} categories={categories} />;
}
