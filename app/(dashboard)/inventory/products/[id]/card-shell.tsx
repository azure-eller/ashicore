import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getItem, getUnitDefinitions } from "@/app/(dashboard)/inventory/queries";
import { getItemCard } from "@/lib/inventory/item-cards";
import { ProductCard, type ProductCardTab } from "./product-card";

type ProductCardShellProps = {
  itemId: string;
  activeTab?: ProductCardTab;
  lotsCount?: number;
  children?: ReactNode;
};

export async function ProductCardShell({
  itemId,
  activeTab,
  lotsCount,
  children,
}: ProductCardShellProps) {
  const item = await getItem(itemId);
  if (!item || item.itemType !== "product") {
    redirect("/inventory/products");
  }

  const card = await getItemCard(itemId);

  const units = await getUnitDefinitions();

  return (
    <ProductCard
      initialItemId={itemId}
      initialCard={card}
      unitOptions={units.map((unit) => ({
        id: unit.id,
        name: unit.name,
        size: unit.size,
        uom: unit.uom,
      }))}
      activeTab={activeTab}
      lotsCount={lotsCount}
    >
      {children}
    </ProductCard>
  );
}
