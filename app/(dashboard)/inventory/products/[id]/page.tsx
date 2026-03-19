import { redirect } from "next/navigation";
import {
  getItem,
  getLots,
  getStockMovements,
  getBomComponents,
} from "@/app/(dashboard)/inventory/queries";
import { ItemDetail } from "@/app/(dashboard)/inventory/item-detail";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [item, bom, lots, movements] = await Promise.all([
    getItem(id),
    getBomComponents(id),
    getLots(id),
    getStockMovements(id),
  ]);
  if (!item) redirect("/inventory/products");

  return (
    <ItemDetail
      item={item}
      itemType="product"
      bom={bom}
      lots={lots}
      movements={movements}
    />
  );
}
