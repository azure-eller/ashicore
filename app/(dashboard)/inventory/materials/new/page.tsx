import { requireModuleAccess } from "@/lib/dal/auth";
import { getUnitDefinitions } from "@/app/(dashboard)/inventory/queries";
import { NewCardPage } from "@/components/card-page/new-card-page";

export default async function NewMaterialPage() {
  await requireModuleAccess("inventory", "operate");
  const units = await getUnitDefinitions();
  const defaultUnit =
    units.find((unit) => unit.name.toLowerCase() === "each") ?? units[0];
  if (!defaultUnit) {
    const { getCategories } = await import("@/app/(dashboard)/inventory/queries");
    const { ItemForm } = await import("@/app/(dashboard)/inventory/item-form");
    const categories = await getCategories();
    return (
      <ItemForm itemType="material" units={units} categories={categories} />
    );
  }

  return (
    <NewCardPage
      itemType="material"
      defaultUnitId={defaultUnit.id}
      unitOptions={units.map((unit) => ({
        id: unit.id,
        name: unit.name,
        size: unit.size,
        uom: unit.uom,
      }))}
    />
  );
}
