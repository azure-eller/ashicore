import { redirect } from "next/navigation";
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
  const { id } = await params;
  const [item, units, categories] = await Promise.all([
    getItem(id),
    getUnitDefinitions(),
    getCategories(),
  ]);
  if (!item) redirect("/inventory/materials");

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-3xl">
        <ItemForm
          itemType="material"
          units={units}
          categories={categories}
          initialData={item}
        />
      </div>
    </div>
  );
}
