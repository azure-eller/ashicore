import { redirect } from "next/navigation";
import {
  getItem,
  getLots,
  getUnitDefinitions,
  getUsedInParents,
} from "@/app/(dashboard)/inventory/queries";
import { getItemCard } from "@/lib/inventory/item-cards";
import { MaterialCard } from "./material-card";

export default async function MaterialDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = await getItem(id);
  if (!item) redirect("/inventory/materials");

  const card = await getItemCard(id);
  const [usedInParents, unitOptions, lots] = await Promise.all([
    getUsedInParents(id),
    getUnitDefinitions(),
    getLots(id),
  ]);

  return (
    <MaterialCard
      initialItemId={id}
      initialCard={card}
      usedInBoms={usedInParents}
      unitOptions={unitOptions.map((unit) => ({
        id: unit.id,
        name: unit.name,
        size: unit.size,
        uom: unit.uom,
      }))}
      initialLots={lots}
    />
  );
}
