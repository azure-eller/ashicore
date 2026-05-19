import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/dal/auth";
import { getUnitDefinitions } from "@/app/(dashboard)/inventory/queries";
import type { ItemCardDto } from "@/lib/api/clients/item-cards";
import { MaterialCard } from "../materials/[id]/material-card";

function emptyCard(itemType: "material", unitDefinitionId: string): ItemCardDto {
  return {
    family: {
      id: "",
      itemType,
      name: "",
      category: null,
      description: null,
      unitDefinitionId,
      unitName: null,
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      deletedAt: null,
    },
    options: [],
    variants: [],
  };
}

export default async function MaterialDraftPage() {
  await requireModuleAccess("inventory", "operate");
  const units = await getUnitDefinitions();
  const defaultUnit =
    units.find((unit) => unit.name.toLowerCase() === "each") ?? units[0];
  if (!defaultUnit) {
    redirect("/inventory/materials");
  }

  return (
    <MaterialCard
      initialItemId={null}
      initialCard={emptyCard("material", defaultUnit.id)}
      usedInBoms={[]}
      unitOptions={units.map((unit) => ({
        id: unit.id,
        name: unit.name,
        size: unit.size,
        uom: unit.uom,
      }))}
      initialLots={[]}
    />
  );
}
