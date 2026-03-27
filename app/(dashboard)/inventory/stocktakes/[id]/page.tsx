import { redirect } from "next/navigation";
import { getStocktake } from "../queries";
import { StocktakeDetail } from "../stocktake-detail";

export default async function StocktakeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const stocktake = await getStocktake(id);

  if (!stocktake) {
    redirect("/inventory/stocktakes");
  }

  return <StocktakeDetail stocktake={stocktake} />;
}
