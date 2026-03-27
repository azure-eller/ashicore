import { getStocktakes } from "./queries";
import { StocktakesTable } from "./stocktakes-table";

export default async function StocktakesPage() {
  const stocktakes = await getStocktakes();
  return <StocktakesTable initialData={stocktakes} />;
}
