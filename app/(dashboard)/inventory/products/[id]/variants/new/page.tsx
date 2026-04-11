import { notFound } from "next/navigation";
import { requireModuleAccess } from "@/lib/dal/auth";
import { getItem, getUnitDefinitions } from "@/app/(dashboard)/inventory/queries";
import { VariantForm } from "@/app/(dashboard)/inventory/variant-form";

export default async function NewVariantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleAccess("inventory", "operate");
  const { id } = await params;
  const [item, units] = await Promise.all([getItem(id), getUnitDefinitions()]);

  if (!item || !item.isMaster) {
    notFound();
  }

  return (
    <div className="mx-auto w-full max-w-6xl py-8">
      <VariantForm
        masterId={item.id}
        masterName={item.name}
        masterAxes={(item.variantAxes as string[] | null) ?? []}
        units={units}
      />
    </div>
  );
}
