import { redirect } from "next/navigation";
import { getItem, getLots } from "@/app/(dashboard)/inventory/queries";
import { LotGridTab } from "@/components/card-page/lot-grid-tab";
import { getItemCard } from "@/lib/inventory/item-cards";

export default async function ProductLotsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [item, card, lots] = await Promise.all([
    getItem(id),
    getItemCard(id),
    getLots(id, { includeNegativeBalances: true }),
  ]);

  if (!item || item.itemType !== "product") redirect("/inventory/products");

  return (
    <LotGridTab
      card={card}
      focusItemId={id}
      lots={lots}
      unitLabel={card.family.unitName}
    />
  );
}
