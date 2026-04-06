import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/dal/auth";
import {
  getItem,
  getUnitDefinitions,
  getCategories,
} from "@/app/(dashboard)/inventory/queries";
import { ItemForm } from "@/app/(dashboard)/inventory/item-form";

export default async function EditMaterialPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleAccess("inventory", "operate");
  const { id } = await params;
  const [item, units, categories] = await Promise.all([
    getItem(id),
    getUnitDefinitions(),
    getCategories(),
  ]);
  if (!item) redirect("/inventory/materials");

  return (
    <div className="mx-auto w-full max-w-5xl py-8">
      <ItemForm
        itemType="material"
        units={units}
        categories={categories}
        initialData={item}
      />
    </div>
  );
}
