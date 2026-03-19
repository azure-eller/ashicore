import { redirect } from "next/navigation";
import {
  getItem,
  getUnitDefinitions,
  getCategories,
  getBomComponents,
  getAvailableComponents,
} from "@/app/(dashboard)/inventory/queries";
import { ItemForm } from "@/app/(dashboard)/inventory/item-form";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [item, units, categories, bom, components] = await Promise.all([
    getItem(id),
    getUnitDefinitions(),
    getCategories(),
    getBomComponents(id),
    getAvailableComponents(id),
  ]);
  if (!item) redirect("/inventory/products");

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-3xl">
        <ItemForm
          itemType="product"
          units={units}
          categories={categories}
          availableComponents={components}
          initialData={{
            ...item,
            bom: bom.map((b) => ({
              componentId: b.componentId,
              quantity: b.quantity,
              percentage: b.percentage,
            })),
          }}
        />
      </div>
    </div>
  );
}
