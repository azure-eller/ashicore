import { getCategories, getUnitDefinitions } from "@/app/(dashboard)/inventory/queries";
import { MaterialForm } from "@/app/(dashboard)/inventory/materials/material-form";

export default async function NewMaterialPage() {
  const [units, categories] = await Promise.all([
    getUnitDefinitions(),
    getCategories(),
  ]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-3xl">
        <MaterialForm units={units} categories={categories} />
      </div>
    </div>
  );
}
